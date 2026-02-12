"""
Background job tasks: PDF generation and lease extraction.
Run worker from backend dir: celery -A jobs.tasks worker -l info
Requires: REDIS_URL, DATABASE_URL; for PDF: REPORT_BASE_URL; for extraction: OPENAI_API_KEY.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path

# Ensure backend root is on path for DB imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Celery app (optional - only if REDIS_URL and celery are installed)
try:
    from celery import Celery
    REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    celery_app = Celery("lease_deck", broker=REDIS_URL, backend=REDIS_URL)
    celery_app.conf.task_routes = {"jobs.tasks.*": {"queue": "lease_deck"}}
except ImportError:
    celery_app = None


def _update_job_pdf_complete(job_id: str, success: bool, s3_key: str | None = None, error: str | None = None):
    from db.session import SessionLocal
    from db.models import Job, Report
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "completed" if success else "failed"
            job.result_s3_key = s3_key
            job.error = error
            job.completed_at = datetime.utcnow()
            db.commit()
            if success and s3_key and job.payload:
                report_id = job.payload.get("report_id")
                if report_id:
                    report = db.query(Report).filter(Report.id == report_id).first()
                    if report:
                        report.s3_key = s3_key
                        db.commit()
    finally:
        db.close()


def _update_job_extraction_complete(job_id: str, success: bool, error: str | None = None):
    from db.session import SessionLocal
    from db.models import Job
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = "completed" if success else "failed"
            job.error = error
            job.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


def _run_pdf_job(job_id: str, report_id: str, organization_id: str) -> tuple[bool, str | None]:
    """Generate PDF for report_id and upload to S3. Returns (success, s3_key or error)."""
    from playwright.sync_api import sync_playwright
    from reports_store import load_report
    from s3_client import upload_bytes, S3_BUCKET

    report_base_url = os.environ.get("REPORT_BASE_URL", "http://localhost:3000")
    data = load_report(report_id)
    if not data:
        return False, "Report not found"
    url = f"{report_base_url}/report?reportId={report_id}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.emulate_media(media="print")
            page.wait_for_timeout(1500)
            pdf_bytes = page.pdf(format="A4", print_background=True)
            browser.close()
    except Exception as e:
        return False, str(e)
    key = f"reports/{organization_id}/{report_id}.pdf"
    if S3_BUCKET and upload_bytes(key, pdf_bytes, "application/pdf"):
        return True, key
    return False, "S3 upload failed"


def _run_extraction_job(job_id: str, file_id: str, organization_id: str, s3_key: str) -> tuple[bool, str | None]:
    """Download PDF from S3, run extraction, store result (and optionally re-upload). Returns (success, error)."""
    from s3_client import download_bytes, upload_bytes, S3_BUCKET
    from lease_extract import extract_lease

    pdf_body = download_bytes(s3_key)
    if not pdf_body:
        return False, "Failed to download from S3"
    try:
        result = extract_lease(BytesIO(pdf_body))
        # Optionally store extraction result JSON in S3
        if S3_BUCKET:
            import json
            out_key = f"extractions/{organization_id}/{file_id}.json"
            upload_bytes(out_key, json.dumps(result.model_dump()).encode(), "application/json")
        return True, None
    except Exception as e:
        return False, str(e)


if celery_app is not None:

    @celery_app.task(bind=True)
    def pdf_export_task(self, job_id: str, report_id: str, organization_id: str):
        ok, out = _run_pdf_job(job_id, report_id, organization_id)
        _update_job_pdf_complete(job_id, ok, s3_key=out if ok else None, error=None if ok else out)
        return {"ok": ok, "s3_key": out if ok else None, "error": None if ok else out}

    @celery_app.task(bind=True)
    def lease_extraction_task(self, job_id: str, file_id: str, organization_id: str, s3_key: str):
        ok, err = _run_extraction_job(job_id, file_id, organization_id, s3_key)
        _update_job_extraction_complete(job_id, ok, error=err)
        return {"ok": ok, "error": err}
