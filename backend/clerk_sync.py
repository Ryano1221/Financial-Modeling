"""
Sync Clerk org/user/member into local DB. Call from webhook or on first rbac_require_org.
"""
from __future__ import annotations

import uuid
from sqlalchemy.orm import Session

from db.models import Organization, User, OrganizationMember, Role


def ensure_user_synced(
    db: Session,
    clerk_user_id: str,
    user_email: str | None = None,
    user_name: str | None = None,
) -> User:
    """Create or update User by clerk_id. Use from Clerk user.created/updated webhook."""
    user = db.query(User).filter(User.clerk_id == clerk_user_id).first()
    if not user:
        user = User(id=str(uuid.uuid4()), clerk_id=clerk_user_id, email=user_email, name=user_name)
        db.add(user)
        db.flush()
    else:
        if user_email is not None:
            user.email = user_email
        if user_name is not None:
            user.name = user_name
    db.commit()
    db.refresh(user)
    return user


def ensure_org_synced(
    db: Session,
    clerk_org_id: str,
    org_name: str = "",
    org_slug: str | None = None,
) -> Organization:
    """Create or update Organization by clerk_org_id. Use from Clerk organization.created/updated."""
    org = db.query(Organization).filter(Organization.clerk_org_id == clerk_org_id).first()
    if not org:
        org = Organization(id=str(uuid.uuid4()), clerk_org_id=clerk_org_id, name=org_name or clerk_org_id)
        db.add(org)
        db.flush()
    else:
        if org_name:
            org.name = org_name
    db.commit()
    db.refresh(org)
    return org


def ensure_org_user_synced(
    db: Session,
    clerk_org_id: str,
    clerk_user_id: str,
    org_name: str = "",
    org_slug: str | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
    org_role: str = "member",
) -> tuple[Organization, User, OrganizationMember]:
    """
    Ensure Organization, User, and OrganizationMember exist; create or update as needed.
    Returns (org, user, member). Use after verifying Clerk JWT so claims are trusted.
    """
    org = db.query(Organization).filter(Organization.clerk_org_id == clerk_org_id).first()
    if not org:
        org = Organization(
            id=str(uuid.uuid4()),
            clerk_org_id=clerk_org_id,
            name=org_name or clerk_org_id,
        )
        db.add(org)
        db.flush()

    user = db.query(User).filter(User.clerk_id == clerk_user_id).first()
    if not user:
        user = User(
            id=str(uuid.uuid4()),
            clerk_id=clerk_user_id,
            email=user_email,
            name=user_name,
        )
        db.add(user)
        db.flush()
    else:
        if user_email is not None:
            user.email = user_email
        if user_name is not None:
            user.name = user_name

    member = (
        db.query(OrganizationMember)
        .filter(
            OrganizationMember.organization_id == org.id,
            OrganizationMember.user_id == user.id,
        )
        .first()
    )
    if not member:
        role_val = org_role if org_role in (r.value for r in Role) else Role.member.value
        member = OrganizationMember(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=user.id,
            role=role_val,
        )
        db.add(member)
        db.flush()
    else:
        if org_role in (r.value for r in Role):
            member.role = org_role

    db.commit()
    db.refresh(org)
    db.refresh(user)
    db.refresh(member)
    return org, user, member
