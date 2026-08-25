import io
import os
import time
import traceback
from datetime import datetime, timezone
from urllib.parse import unquote_plus

import boto3
from botocore.exceptions import ClientError
from pypdf import PdfReader

TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "LexCloudDocuments")

s3 = boto3.client("s3")
textract = boto3.client("textract")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

POLL_SECONDS = 2
MAX_WAIT = 280


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def put_status(document_name, status, **extra):
    item = {
        "document_name": document_name,
        "status": status,
        "updatedAt": now_iso(),
    }
    item.update(extra)
    table.put_item(Item=item)


def collect_lines(job_id):
    pages = []
    next_token = None
    while True:
        kwargs = {"JobId": job_id}
        if next_token:
            kwargs["NextToken"] = next_token
        resp = textract.get_document_text_detection(**kwargs)
        pages.append(resp)
        next_token = resp.get("NextToken")
        if not next_token:
            break
    lines = []
    for resp in pages:
        for block in resp.get("Blocks") or []:
            if block.get("BlockType") == "LINE" and block.get("Text"):
                lines.append(block["Text"])
    return "\n".join(lines)


def extract_with_textract(bucket, key):
    started = textract.start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    job_id = started["JobId"]
    deadline = time.time() + MAX_WAIT
    status = "IN_PROGRESS"
    desc = {}
    while time.time() < deadline:
        desc = textract.get_document_text_detection(JobId=job_id, MaxResults=1)
        status = desc.get("JobStatus")
        if status in {"SUCCEEDED", "FAILED", "PARTIAL_SUCCESS"}:
            break
        time.sleep(POLL_SECONDS)
    if status == "FAILED":
        message = (desc.get("StatusMessage") or "Textract job failed")[:500]
        raise RuntimeError(message)
    if status not in {"SUCCEEDED", "PARTIAL_SUCCESS"}:
        raise TimeoutError(f"Textract job {job_id} still {status}")
    return collect_lines(job_id)


def extract_with_pypdf(bucket, key):
    obj = s3.get_object(Bucket=bucket, Key=key)
    reader = PdfReader(io.BytesIO(obj["Body"].read()))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages).strip()


def extract_text(bucket, key):
    try:
        return extract_with_textract(bucket, key), "textract"
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        print(f"Textract unavailable ({code}); falling back to pypdf")
        if code in {
            "SubscriptionRequiredException",
            "AccessDeniedException",
            "UnrecognizedClientException",
            "InvalidSignatureException",
        }:
            return extract_with_pypdf(bucket, key), "pypdf"
        raise


def lambda_handler(event, context):
    try:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        if not key.lower().startswith("uploads/") or key.endswith("/"):
            print(f"skip key {key}")
            return {"skipped": key}
        put_status(key, "PROCESSING", bucket=bucket)
        text, engine = extract_text(bucket, key)
        if not text.strip():
            put_status(key, "FAILED", error="No text could be extracted", bucket=bucket, engine=engine)
            return {"status": "FAILED", "document_name": key}
        put_status(
            key,
            "READY",
            bucket=bucket,
            originalText=text,
            charCount=len(text),
            engine=engine,
        )
        print(f"processed {key} chars={len(text)} engine={engine}")
        return {"status": "READY", "document_name": key, "charCount": len(text), "engine": engine}
    except Exception as exc:
        print(traceback.format_exc())
        try:
            record = event["Records"][0]
            key = unquote_plus(record["s3"]["object"]["key"])
            put_status(key, "FAILED", error=str(exc)[:500])
        except Exception:
            pass
        return {"status": "FAILED", "error": str(exc)}
