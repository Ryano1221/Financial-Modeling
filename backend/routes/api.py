"""
Authenticated API: Deals, Scenarios, Runs, Reports, Files.
Uses rbac_require_org, audit log, Stripe usage, S3, background jobs.
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import rbac_require_org, ClerkClaims
from db.session import get_db
from db.models import (
    Organization,
    OrganizationMember,
    Deal as DealModel,
    Scenario as ScenarioModel,
    Run as RunModel,
    Report as ReportModel,
    File as FileModel,
    Job as JobModel,
    OrganizationBranding as OrganizationBrandingModel,
    Role,
    JobType,
    JobStatus,
)
from audit import log as audit_log
from stripe_billing import ensure_customer, report_usage_runs, report_usage_pdf_export
from s3_client import upload_fileobj, presigned_url, S3_BUCKET
from models import Scenario as ScenarioPydantic, CashflowResult
from engine.compute import compute_cashflows

router = APIRouter(prefix="/api/v1", tags=["api"])


# --- Request/response schemas ---

class DealCreate(BaseModel):
    name: str
    metadata: Optional[dict] = None


class DealUpdate(BaseModel):
    name: Optional[str] = None
    metadata: Optional[dict] = None


class ScenarioCreate(BaseModel):
    name: str
    payload: dict  # full Scenario JSON


class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    payload: Optional[dict] = None


class RunCreate(BaseModel):
    scenario_id: str
    # payload already in DB; we compute and store result


class ReportCreate(BaseModel):
    scenarios: list[dict]  # list of {scenario, result}
    branding: Optional[dict] = None


ALLOWED_LOGO_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml"}
MAX_LOGO_BYTES = 1_500_000


def _branding_payload_for(row: OrganizationBrandingModel | None, org_id: str) -> dict[str, Any]:
    if not row or not row.logo_bytes:
        return {
            "organization_id": org_id,
            "has_logo": False,
            "logo_content_type": None,
            "logo_filename": None,
            "logo_data_url": None,
            "logo_asset_bytes": None,
            "theme_hash": None,
            "logo_updated_at": None,
        }
    content_type = (row.logo_content_type or "image/png").strip() or "image/png"
    logo_b64 = base64.b64encode(row.logo_bytes).decode("ascii")
    theme_hash = (row.logo_sha256 or "").strip() or hashlib.sha256(row.logo_bytes).hexdigest()
    return {
        "organization_id": org_id,
        "has_logo": True,
        "logo_content_type": content_type,
        "logo_filename": row.logo_filename,
        "logo_data_url": f"data:{content_type};base64,{logo_b64}",
        "logo_asset_bytes": logo_b64,
        "theme_hash": theme_hash,
        "logo_updated_at": row.logo_updated_at.isoformat() if row.logo_updated_at else None,
    }


# --- Deals ---

@router.get("/branding")
def get_branding(
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    row = (
        db.query(OrganizationBrandingModel)
        .filter(OrganizationBrandingModel.organization_id == org.id)
        .first()
    )
    return _branding_payload_for(row, org.id)


@router.post("/branding/logo")
async def upload_branding_logo(
    file: UploadFile = File(...),
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    filename_lower = file.filename.lower().strip()
    content_type = (file.content_type or "").lower().strip()
    if content_type not in ALLOWED_LOGO_CONTENT_TYPES:
        if filename_lower.endswith(".png"):
            content_type = "image/png"
        elif filename_lower.endswith(".jpg") or filename_lower.endswith(".jpeg"):
            content_type = "image/jpeg"
        elif filename_lower.endswith(".svg"):
            content_type = "image/svg+xml"
    if content_type not in ALLOWED_LOGO_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPG, or SVG")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 1.5MB")

    logo_sha = hashlib.sha256(data).hexdigest()
    row = (
        db.query(OrganizationBrandingModel)
        .filter(OrganizationBrandingModel.organization_id == org.id)
        .first()
    )
    now = datetime.utcnow()
    if row is None:
        row = OrganizationBrandingModel(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            logo_bytes=data,
            logo_content_type=content_type,
            logo_filename=file.filename,
            logo_sha256=logo_sha,
            logo_updated_at=now,
        )
        db.add(row)
    else:
        row.logo_bytes = data
        row.logo_content_type = content_type
        row.logo_filename = file.filename
        row.logo_sha256 = logo_sha
        row.logo_updated_at = now
    db.commit()
    audit_log(
        db,
        org.id,
        claims.sub,
        "update",
        "branding",
        row.id,
        {"filename": file.filename, "content_type": content_type},
    )
    return _branding_payload_for(row, org.id)


@router.delete("/branding/logo")
def delete_branding_logo(
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    row = (
        db.query(OrganizationBrandingModel)
        .filter(OrganizationBrandingModel.organization_id == org.id)
        .first()
    )
    if row:
        row.logo_bytes = None
        row.logo_content_type = None
        row.logo_filename = None
        row.logo_sha256 = None
        row.logo_updated_at = None
        db.commit()
        audit_log(db, org.id, claims.sub, "delete", "branding", row.id, {"logo_deleted": True})
    return _branding_payload_for(row, org.id)

@router.get("/deals")
def list_deals(
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deals = db.query(DealModel).filter(DealModel.organization_id == org.id).order_by(DealModel.updated_at.desc()).all()
    return [{"id": d.id, "name": d.name, "metadata": d.metadata_ or {}, "created_at": d.created_at.isoformat() if d.created_at else None} for d in deals]


@router.post("/deals")
def create_deal(
    body: DealCreate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal_id = str(uuid.uuid4())
    deal = DealModel(
        id=deal_id,
        organization_id=org.id,
        name=body.name,
        metadata_=body.metadata or {},
    )
    db.add(deal)
    db.commit()
    audit_log(db, org.id, claims.sub, "create", "deal", deal_id, {"name": body.name})
    return {"id": deal.id, "name": deal.name, "metadata": deal.metadata_ or {}}


@router.get("/deals/{deal_id}")
def get_deal(
    deal_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal = db.query(DealModel).filter(DealModel.id == deal_id, DealModel.organization_id == org.id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return {"id": deal.id, "name": deal.name, "metadata": deal.metadata_ or {}, "created_at": deal.created_at.isoformat() if deal.created_at else None}


@router.patch("/deals/{deal_id}")
def update_deal(
    deal_id: str,
    body: DealUpdate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal = db.query(DealModel).filter(DealModel.id == deal_id, DealModel.organization_id == org.id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    if body.name is not None:
        deal.name = body.name
    if body.metadata is not None:
        deal.metadata_ = body.metadata
    db.commit()
    audit_log(db, org.id, claims.sub, "update", "deal", deal_id, {})
    return {"id": deal.id, "name": deal.name, "metadata": deal.metadata_ or {}}


@router.delete("/deals/{deal_id}")
def delete_deal(
    deal_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal = db.query(DealModel).filter(DealModel.id == deal_id, DealModel.organization_id == org.id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    db.delete(deal)
    db.commit()
    audit_log(db, org.id, claims.sub, "delete", "deal", deal_id, {})
    return {"ok": True}


# --- Scenarios ---

@router.get("/deals/{deal_id}/scenarios")
def list_scenarios(
    deal_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal = db.query(DealModel).filter(DealModel.id == deal_id, DealModel.organization_id == org.id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    scenarios = db.query(ScenarioModel).filter(ScenarioModel.deal_id == deal_id).order_by(ScenarioModel.updated_at.desc()).all()
    return [{"id": s.id, "name": s.name, "payload": s.payload, "created_at": s.created_at.isoformat() if s.created_at else None} for s in scenarios]


@router.post("/deals/{deal_id}/scenarios")
def create_scenario(
    deal_id: str,
    body: ScenarioCreate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    deal = db.query(DealModel).filter(DealModel.id == deal_id, DealModel.organization_id == org.id).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    scenario_id = str(uuid.uuid4())
    scenario = ScenarioModel(
        id=scenario_id,
        deal_id=deal_id,
        name=body.name,
        payload=body.payload,
    )
    db.add(scenario)
    db.commit()
    audit_log(db, org.id, claims.sub, "create", "scenario", scenario_id, {"deal_id": deal_id, "name": body.name})
    return {"id": scenario.id, "name": scenario.name, "payload": scenario.payload}


@router.get("/scenarios/{scenario_id}")
def get_scenario(
    scenario_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    scenario = db.query(ScenarioModel).join(DealModel).filter(
        ScenarioModel.id == scenario_id,
        DealModel.organization_id == org.id,
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"id": scenario.id, "name": scenario.name, "payload": scenario.payload, "deal_id": scenario.deal_id}


@router.patch("/scenarios/{scenario_id}")
def update_scenario(
    scenario_id: str,
    body: ScenarioUpdate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    scenario = db.query(ScenarioModel).join(DealModel).filter(
        ScenarioModel.id == scenario_id,
        DealModel.organization_id == org.id,
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if body.name is not None:
        scenario.name = body.name
    if body.payload is not None:
        scenario.payload = body.payload
    db.commit()
    audit_log(db, org.id, claims.sub, "update", "scenario", scenario_id, {})
    return {"id": scenario.id, "name": scenario.name, "payload": scenario.payload}


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(
    scenario_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    scenario = db.query(ScenarioModel).join(DealModel).filter(
        ScenarioModel.id == scenario_id,
        DealModel.organization_id == org.id,
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    db.delete(scenario)
    db.commit()
    audit_log(db, org.id, claims.sub, "delete", "scenario", scenario_id, {})
    return {"ok": True}


# --- Runs ---

@router.post("/runs")
def create_run(
    body: RunCreate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    scenario = db.query(ScenarioModel).join(DealModel).filter(
        ScenarioModel.id == body.scenario_id,
        DealModel.organization_id == org.id,
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    try:
        scen = ScenarioPydantic.model_validate(scenario.payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid scenario payload: {e}")
    _, result = compute_cashflows(scen)
    result_dict = result.model_dump()
    run_id = str(uuid.uuid4())
    run = RunModel(
        id=run_id,
        scenario_id=body.scenario_id,
        result=result_dict,
    )
    db.add(run)
    db.commit()
    audit_log(db, org.id, claims.sub, "create", "run", run_id, {"scenario_id": body.scenario_id})
    # Stripe usage
    stripe_id = ensure_customer(org.id, org.name, org.stripe_customer_id)
    if stripe_id:
        report_usage_runs(stripe_id, 1)
        if not org.stripe_customer_id:
            org.stripe_customer_id = stripe_id
            db.commit()
    return {"id": run.id, "scenario_id": run.scenario_id, "result": run.result}


@router.get("/scenarios/{scenario_id}/runs")
def list_runs(
    scenario_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    scenario = db.query(ScenarioModel).join(DealModel).filter(
        ScenarioModel.id == scenario_id,
        DealModel.organization_id == org.id,
    ).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")
    runs = db.query(RunModel).filter(RunModel.scenario_id == scenario_id).order_by(RunModel.created_at.desc()).all()
    return [{"id": r.id, "scenario_id": r.scenario_id, "result": r.result, "created_at": r.created_at.isoformat() if r.created_at else None} for r in runs]


# --- Reports ---

@router.post("/reports")
def create_report(
    body: ReportCreate,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    report_id = str(uuid.uuid4())
    branding_payload = dict(body.branding or {})
    branding_payload.setdefault("org_id", org.id)
    row = (
        db.query(OrganizationBrandingModel)
        .filter(OrganizationBrandingModel.organization_id == org.id)
        .first()
    )
    if row and row.logo_bytes:
        logo_b64 = base64.b64encode(row.logo_bytes).decode("ascii")
        branding_payload.setdefault("logo_asset_bytes", logo_b64)
        branding_payload.setdefault("logo_url", f"data:{(row.logo_content_type or 'image/png')};base64,{logo_b64}")
        branding_payload["theme_hash"] = (row.logo_sha256 or "").strip() or hashlib.sha256(row.logo_bytes).hexdigest()
    if not branding_payload.get("theme_hash"):
        theme_payload = {
            "org_id": branding_payload.get("org_id"),
            "logo_asset_bytes": branding_payload.get("logo_asset_bytes"),
            "logo_url": branding_payload.get("logo_url"),
            "brand_name": branding_payload.get("brand_name"),
            "primary_color": branding_payload.get("primary_color"),
        }
        branding_payload["theme_hash"] = hashlib.sha256(
            json.dumps(theme_payload, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
    payload = {"scenarios": body.scenarios, "branding": branding_payload}
    # Persist to DB
    report = ReportModel(
        id=report_id,
        organization_id=org.id,
        payload=payload,
    )
    db.add(report)
    # Save to file store so background PDF job can load by report_id
    from pathlib import Path
    from reports_store import REPORTS_DIR
    import json
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / f"{report_id}.json"
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    db.commit()
    audit_log(db, org.id, claims.sub, "create", "report", report_id, {})
    return {"id": report_id, "payload": payload}


@router.get("/reports/{report_id}")
def get_report(
    report_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    report = db.query(ReportModel).filter(ReportModel.id == report_id, ReportModel.organization_id == org.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"id": report.id, "payload": report.payload, "s3_key": report.s3_key, "job_id": report.job_id}


@router.post("/reports/{report_id}/pdf")
def request_report_pdf(
    report_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    """Enqueue PDF export job; return job_id. Client can poll job status or get PDF URL when ready."""
    claims, org, _ = rbac
    report = db.query(ReportModel).filter(ReportModel.id == report_id, ReportModel.organization_id == org.id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    job_id = str(uuid.uuid4())
    job = JobModel(
        id=job_id,
        organization_id=org.id,
        type=JobType.pdf_export.value,
        status=JobStatus.pending.value,
        payload={"report_id": report_id},
    )
    db.add(job)
    report.job_id = job_id
    db.commit()
    audit_log(db, org.id, claims.sub, "request_pdf", "report", report_id, {"job_id": job_id})
    # Enqueue Celery task
    try:
        from jobs.tasks import pdf_export_task
        if pdf_export_task:
            pdf_export_task.delay(job_id, report_id, org.id)
    except Exception:
        pass
    # Stripe usage when PDF is requested
    stripe_id = ensure_customer(org.id, org.name, org.stripe_customer_id)
    if stripe_id:
        report_usage_pdf_export(stripe_id, 1)
        if not org.stripe_customer_id:
            org.stripe_customer_id = stripe_id
            db.commit()
    return {"job_id": job_id, "report_id": report_id, "status": "pending"}


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    job = db.query(JobModel).filter(JobModel.id == job_id, JobModel.organization_id == org.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "id": job.id,
        "type": job.type,
        "status": job.status,
        "payload": job.payload,
        "result_s3_key": job.result_s3_key,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


# --- Files (upload lease PDF, list, get) ---

@router.post("/files")
async def upload_lease_file(
    file: UploadFile = File(...),
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    claims, org, _ = rbac
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    file_id = str(uuid.uuid4())
    s3_key = f"leases/{org.id}/{file_id}/{file.filename}"
    if S3_BUCKET and upload_fileobj(s3_key, __to_fileobj(content), "application/pdf"):
        pass
    else:
        raise HTTPException(status_code=503, detail="S3 upload not configured or failed")
    job_id = str(uuid.uuid4())
    job = JobModel(
        id=job_id,
        organization_id=org.id,
        type=JobType.lease_extraction.value,
        status=JobStatus.pending.value,
        payload={"file_id": file_id, "s3_key": s3_key},
    )
    db.add(job)
    file_row = FileModel(
        id=file_id,
        organization_id=org.id,
        filename=file.filename or "lease.pdf",
        s3_key=s3_key,
        content_type="application/pdf",
        job_id=job_id,
    )
    db.add(file_row)
    db.commit()
    audit_log(db, org.id, claims.sub, "upload", "file", file_id, {"filename": file.filename})
    try:
        from jobs.tasks import lease_extraction_task
        if lease_extraction_task:
            lease_extraction_task.delay(job_id, file_id, org.id, s3_key)
    except Exception:
        pass
    return {"id": file_id, "filename": file.filename, "s3_key": s3_key, "job_id": job_id, "status": "pending"}


def __to_fileobj(data: bytes):
    from io import BytesIO
    return BytesIO(data)


@router.get("/files")
def list_files(
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    files = db.query(FileModel).filter(FileModel.organization_id == org.id).order_by(FileModel.created_at.desc()).all()
    return [{"id": f.id, "filename": f.filename, "s3_key": f.s3_key, "job_id": f.job_id, "created_at": f.created_at.isoformat() if f.created_at else None} for f in files]


@router.get("/files/{file_id}")
def get_file(
    file_id: str,
    rbac: tuple[ClerkClaims, Organization, OrganizationMember] = Depends(rbac_require_org),
    db: Session = Depends(get_db),
):
    claims, org, _ = rbac
    file_row = db.query(FileModel).filter(FileModel.id == file_id, FileModel.organization_id == org.id).first()
    if not file_row:
        raise HTTPException(status_code=404, detail="File not found")
    url = presigned_url(file_row.s3_key) if file_row.s3_key else None
    return {"id": file_row.id, "filename": file_row.filename, "s3_key": file_row.s3_key, "job_id": file_row.job_id, "download_url": url}
