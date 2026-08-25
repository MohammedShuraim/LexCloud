import base64
import json
import traceback

import boto3

polly = boto3.client("polly")
MAX_CHARS = 2800


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


def parse_body(event):
    if not isinstance(event, dict):
        return {}
    raw = event.get("body")
    if raw is None:
        return event
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})
    try:
        body = parse_body(event)
        text = (body.get("text") or body.get("message") or "").strip()
        if not text:
            text = "Hello, this is a default test from LexCloud."
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS]
        polly_resp = polly.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId="Aditi",
            Engine="standard",
        )
        stream = polly_resp.get("AudioStream")
        if stream is None:
            raise RuntimeError("Polly did not return AudioStream")
        audio_b64 = base64.b64encode(stream.read()).decode("utf-8")
        return respond(200, {"audioBase64": audio_b64})
    except Exception as exc:
        print("ERROR:", traceback.format_exc())
        return respond(500, {"error": str(exc)})
