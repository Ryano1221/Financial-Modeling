"""
S3 storage for PDFs and uploaded lease files.
Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET.
"""
from __future__ import annotations

import os
from io import BytesIO
from typing import BinaryIO

S3_BUCKET = os.environ.get("S3_BUCKET", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


def _client():
    try:
        import boto3
        return boto3.client("s3", region_name=AWS_REGION)
    except ImportError:
        return None


def upload_bytes(key: str, body: bytes, content_type: str) -> bool:
    if not S3_BUCKET:
        return False
    client = _client()
    if not client:
        return False
    try:
        client.put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType=content_type)
        return True
    except Exception:
        return False


def upload_fileobj(key: str, fileobj: BinaryIO, content_type: str) -> bool:
    if not S3_BUCKET:
        return False
    client = _client()
    if not client:
        return False
    try:
        client.upload_fileobj(fileobj, S3_BUCKET, key, ExtraArgs={"ContentType": content_type})
        return True
    except Exception:
        return False


def download_bytes(key: str) -> bytes | None:
    if not S3_BUCKET:
        return None
    client = _client()
    if not client:
        return None
    try:
        buf = BytesIO()
        client.download_fileobj(S3_BUCKET, key, buf)
        return buf.getvalue()
    except Exception:
        return None


def presigned_url(key: str, expires_in: int = 3600) -> str | None:
    if not S3_BUCKET:
        return None
    client = _client()
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "get_object", Params={"Bucket": S3_BUCKET, "Key": key}, ExpiresIn=expires_in
        )
    except Exception:
        return None
