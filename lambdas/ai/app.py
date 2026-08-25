import json
import os
import re
import urllib.error
import urllib.request

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "LexCloudDocuments")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_API_URL = os.environ.get(
    "GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions"
)
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
MAX_PROMPT_CHARS = int(os.environ.get("MAX_PROMPT_CHARS", "4500"))

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
translate_client = boto3.client("translate")

LANGUAGE_CODE_MAP = {
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "ml": "Malayalam",
    "kn": "Kannada",
}

SYSTEM_PROMPT = (
    "You are a professional legal expert highly knowledgeable about Indian law. "
    "Your responses must be clear, detailed, and structured. "
    "You are not a substitute for a licensed advocate."
)


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def chunk_text(text, size=900, overlap=120):
    if not text:
        return []
    chunks = []
    step = max(1, size - overlap)
    index = 0
    while index < len(text):
        chunks.append(text[index : index + size])
        index += step
    return chunks


def score_chunk(query, chunk):
    terms = set(re.findall(r"[a-z0-9]+", (query or "").lower()))
    hay = set(re.findall(r"[a-z0-9]+", (chunk or "").lower()))
    if not terms:
        return 0.0
    return len(terms & hay) / len(terms)


def retrieve_chunks(query, text, k=4):
    chunks = chunk_text(text)
    if not chunks:
        return []
    ranked = sorted(chunks, key=lambda chunk: score_chunk(query, chunk), reverse=True)
    selected = [chunk for chunk in ranked[:k] if score_chunk(query, chunk) > 0]
    if not selected:
        selected = chunks[:k]
    merged = []
    used = 0
    for chunk in selected:
        if used + len(chunk) > MAX_PROMPT_CHARS:
            merged.append(chunk[: max(0, MAX_PROMPT_CHARS - used)])
            break
        merged.append(chunk)
        used += len(chunk)
    return merged


def build_rag_prompt(document_text, user_query):
    return (
        "Provide a detailed, educational, and actionable analysis based ONLY on the "
        "provided document excerpt. If information is missing, say it is not in the document.\n\n"
        f"Document Excerpt:\n{document_text}\n\n"
        f"User's Detailed Question:\n{user_query}\n\n"
        "Respond with this structure:\n"
        "**1. Comprehensive Analysis:** multi-sentence answer with clause references when present.\n"
        "**2. Legal Context & Rules:** Indian contract or statutory context.\n"
        "**3. Suggested Next Steps:** practical compliance or counsel next steps."
    )


def call_groq(user_content):
    if not GROQ_API_KEY or GROQ_API_KEY == "changeme":
        raise ValueError("GROQ_API_KEY is not configured")
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": 900,
    }
    request = urllib.request.Request(
        GROQ_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "LexCloud/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        print("Groq HTTP error:", detail)
        raise RuntimeError(f"Groq API {exc.code}") from exc
    return data["choices"][0]["message"]["content"]


def translate_content(text, target_lang):
    pieces = []
    remaining = text or ""
    while remaining:
        slice_text = remaining[:9000]
        remaining = remaining[9000:]
        result = translate_client.translate_text(
            Text=slice_text,
            SourceLanguageCode="en",
            TargetLanguageCode=target_lang,
        )
        pieces.append(result["TranslatedText"])
    return "".join(pieces)


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})
    try:
        body = json.loads(event.get("body") or "{}")
        document_name = body.get("document_name")
        user_query = (body.get("query") or "").strip()
        target_lang_code = body.get("target_language")
        is_translation = user_query.upper() == "FETCH_FULL_TRANSLATION"
        is_general_chat = not document_name or document_name == "GENERAL_QUERY"

        if not user_query and not is_translation:
            return respond(400, {"error": "Query field is required for chat/rag mode."})

        if is_general_chat and not is_translation:
            answer = call_groq(user_query)
            return respond(200, {"answer": answer, "mode": "chat"})

        if not document_name:
            return respond(400, {"error": "Document upload is required for this mode."})

        resp = table.get_item(Key={"document_name": document_name})
        item = resp.get("Item")
        if not item:
            return respond(
                404,
                {"error": f"Document '{document_name}' not found. Has Textract finished?"},
            )
        original_text = item.get("originalText") or ""
        if not original_text:
            return respond(400, {"error": "Original document text is not ready yet."})

        if is_translation:
            if not target_lang_code or target_lang_code not in LANGUAGE_CODE_MAP:
                return respond(400, {"error": "Invalid or missing target_language code."})
            translated = translate_content(original_text, target_lang_code)
            return respond(
                200,
                {
                    "answer": translated,
                    "mode": "translate",
                    "language": LANGUAGE_CODE_MAP[target_lang_code],
                },
            )

        excerpt = "\n\n".join(retrieve_chunks(user_query, original_text))
        answer = call_groq(build_rag_prompt(excerpt, user_query))
        return respond(200, {"answer": answer, "mode": "rag"})
    except ValueError as exc:
        return respond(500, {"error": str(exc)})
    except ClientError as exc:
        print("AWS error", exc)
        return respond(500, {"error": "AWS Service Error: " + str(exc)})
    except Exception as exc:
        print("ai error", exc)
        return respond(500, {"error": "Internal server error: " + str(exc)})
