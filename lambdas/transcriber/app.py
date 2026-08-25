import base64
import json
import os
import traceback
from http.client import HTTPSConnection
from urllib.parse import urlparse

GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MAX_FILE_BYTES = 9 * 1024 * 1024


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def decode_body(event):
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    content_type = headers.get("content-type")
    body = event.get("body") or b""
    is_b64 = event.get("isBase64Encoded", False)
    if isinstance(body, str):
        if is_b64:
            try:
                body_bytes = base64.b64decode(body)
            except Exception:
                body_bytes = body.encode("utf-8", errors="ignore")
        else:
            body_bytes = body.encode("utf-8", errors="ignore")
    elif isinstance(body, bytes):
        body_bytes = body
    else:
        body_bytes = b""
    return body_bytes, content_type


def parse_multipart(body_bytes, content_type_header):
    if not content_type_header or "multipart/form-data" not in content_type_header:
        return {}
    boundary = None
    for part in content_type_header.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip().strip('"')
            break
    if not boundary:
        return {}
    boundary_bytes = b"--" + boundary.encode("utf-8")
    out = {}
    for seg in body_bytes.split(boundary_bytes):
        seg = seg.strip(b"\r\n")
        if not seg or seg == b"--":
            continue
        try:
            header_blob, value = seg.split(b"\r\n\r\n", 1)
        except ValueError:
            continue
        headers = {}
        for line in header_blob.decode("utf-8", errors="ignore").split("\r\n"):
            if ":" in line:
                key, val = line.split(":", 1)
                headers[key.strip().lower()] = val.strip()
        dispo = headers.get("content-disposition", "")
        name = None
        filename = None
        for token in dispo.split(";"):
            token = token.strip()
            if token.startswith("name="):
                name = token.split("=", 1)[1].strip().strip('"')
            if token.startswith("filename="):
                filename = token.split("=", 1)[1].strip().strip('"')
        if value.endswith(b"--"):
            value = value[:-2]
        if value.endswith(b"\r\n"):
            value = value[:-2]
        out[name or filename or f"part{len(out) + 1}"] = {
            "filename": filename,
            "content_type": headers.get("content-type"),
            "content": value,
        }
    return out


def post_to_groq(file_bytes, filename, file_content_type, api_key):
    parsed = urlparse(GROQ_WHISPER_URL)
    boundary = "------------------------" + os.urandom(12).hex()
    crlf = "\r\n"
    disposition = f'Content-Disposition: form-data; name="file"; filename="{filename}"'
    content_type_hdr = f"Content-Type: {file_content_type or 'application/octet-stream'}"
    file_header = f"--{boundary}{crlf}{disposition}{crlf}{content_type_hdr}{crlf}{crlf}".encode(
        "utf-8"
    )
    model_part = (
        f"--{boundary}{crlf}"
        f'Content-Disposition: form-data; name="model"{crlf}{crlf}'
        f"whisper-large-v3-turbo{crlf}"
    ).encode("utf-8")
    closing = f"--{boundary}--{crlf}".encode("utf-8")
    body = file_header + file_bytes + crlf.encode("utf-8") + model_part + closing
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
        "Accept": "application/json",
    }
    conn = HTTPSConnection(parsed.hostname, timeout=60)
    try:
        conn.request("POST", parsed.path, body=body, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read()
    finally:
        conn.close()


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})
    try:
        groq_key = os.environ.get("GROQ_API_KEY")
        if not groq_key or groq_key == "changeme":
            return respond(500, {"error": "GROQ_API_KEY env var not set"})
        body_bytes, content_type = decode_body(event)
        parsed_parts = {}
        if content_type and "multipart/form-data" in content_type:
            parsed_parts = parse_multipart(body_bytes, content_type)
        file_part = parsed_parts.get("file")
        if not file_part:
            for value in parsed_parts.values():
                if value.get("filename"):
                    file_part = value
                    break
        if file_part:
            file_bytes = file_part["content"]
            filename = file_part.get("filename") or "upload.webm"
            file_ct = file_part.get("content_type") or "application/octet-stream"
        else:
            if not body_bytes:
                return respond(400, {"error": "No file data found in request"})
            file_bytes = body_bytes
            filename = "upload.bin"
            file_ct = content_type or "application/octet-stream"
        if len(file_bytes) > MAX_FILE_BYTES:
            return respond(413, {"error": "File too large", "size": len(file_bytes)})
        status, resp_data = post_to_groq(file_bytes, filename, file_ct, groq_key)
        try:
            resp_json = json.loads(resp_data.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError:
            resp_json = {"raw": resp_data[:400].decode("utf-8", errors="ignore")}
        if status != 200:
            return respond(502, {"error": "Whisper backend returned non-200", "status": status, "result": resp_json})
        transcription = None
        if isinstance(resp_json, dict):
            transcription = resp_json.get("text") or resp_json.get("transcription")
        return respond(200, {"transcription": transcription, "raw_response": resp_json})
    except Exception as exc:
        print("ERROR:", traceback.format_exc())
        return respond(500, {"error": str(exc)})
