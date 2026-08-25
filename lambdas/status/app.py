import json
import os

import boto3

TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME", "LexCloudDocuments")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def respond(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
        },
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return respond(200, {"ok": True})
    params = event.get("queryStringParameters") or {}
    document_name = (params.get("document_name") or params.get("name") or "").strip()
    if not document_name:
        return respond(400, {"ready": False, "error": "document_name is required"})
    resp = table.get_item(Key={"document_name": document_name})
    item = resp.get("Item")
    if not item:
        return respond(200, {"ready": False, "status": "NOT_FOUND", "document_name": document_name})
    status = item.get("status") or ("READY" if item.get("originalText") else "UNKNOWN")
    payload = {
        "document_name": document_name,
        "status": status,
        "ready": bool(item.get("originalText")) and status == "READY",
        "charCount": int(item.get("charCount") or 0),
        "updatedAt": item.get("updatedAt"),
    }
    if item.get("error"):
        payload["error"] = item["error"]
    return respond(200, payload)
