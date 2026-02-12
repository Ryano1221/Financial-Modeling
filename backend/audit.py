"""Audit log helper. Call after mutations."""
from __future__ import annotations

import uuid
from sqlalchemy.orm import Session

from db.models import AuditLog


def log(
    db: Session,
    organization_id: str,
    actor_id: str,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    details: dict | None = None,
) -> None:
    entry = AuditLog(
        id=str(uuid.uuid4()),
        organization_id=organization_id,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
    )
    db.add(entry)
    db.commit()
