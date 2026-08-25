import json
import os
import re
import uuid

import boto3
from botocore.config import Config

BUCKET = os.environ.get("DOCUMENT_BUCKET", "")
REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "ap-south-1"
s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=f"https://s3.{REGION}.amazonaws.com",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
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


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})
    try:
        body = json.loads(event.get("body") or "{}")
        file_name = body.get("fileName") or "document.pdf"
        file_type = body.get("fileType") or "application/pdf"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file_name).strip("._") or "document.pdf"
        if not safe.lower().endswith(".pdf"):
            safe = f"{safe}.pdf"
        key = f"uploads/{uuid.uuid4().hex}-{safe[:120]}"
        upload_url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": BUCKET,
                "Key": key,
                "ContentType": file_type,
            },
            ExpiresIn=600,
            HttpMethod="PUT",
        )
        return respond(
            200,
            {
                "uploadUrl": upload_url,
                "document_name": key,
                "fileKey": key,
            },
        )
    except Exception as exc:
        print(f"uploader error: {exc}")
        return respond(500, {"error": str(exc)})
