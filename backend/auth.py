"""
Clerk JWT verification and RBAC.
Expect Authorization: Bearer <session_token> or cookie.
Set CLERK_JWT_ISSUER (e.g. https://your-clerk-domain.clerk.accounts.dev) and optionally
CLERK_JWKS_URL; or use CLERK_SECRET_KEY for verification.
"""
from __future__ import annotations

import os
from typing import Annotated, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, APIKeyHeader
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.session import SessionLocal, get_db
from db.models import Organization, OrganizationMember, User, Role

security = HTTPBearer(auto_error=False)
internal_key_header = APIKeyHeader(name="X-Internal-Secret", auto_error=False)


class ClerkClaims(BaseModel):
    sub: str  # clerk user id
    org_id: Optional[str] = None
    org_role: Optional[str] = None
    org_slug: Optional[str] = None


def verify_clerk_token(token: str) -> ClerkClaims:
    """Verify Clerk session JWT and return claims."""
    issuer = os.environ.get("CLERK_JWT_ISSUER")
    if not issuer:
        raise HTTPException(status_code=503, detail="CLERK_JWT_ISSUER not set")
    try:
        # Decode without verification first to get kid, then verify with JWKS
        unverified = jwt.decode(token, options={"verify_signature": False})
        jwks_client = jwt.PyJWKClient(
            os.environ.get("CLERK_JWKS_URL", issuer.rstrip("/") + "/.well-known/jwks.json")
        )
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
        )
        return ClerkClaims(
            sub=payload.get("sub", ""),
            org_id=payload.get("org_id"),
            org_role=payload.get("org_role"),
            org_slug=payload.get("org_slug"),
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_optional_claims(
    creds: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> Optional[ClerkClaims]:
    if not creds or not creds.credentials:
        return None
    return verify_clerk_token(creds.credentials)


def require_auth(
    claims: Annotated[Optional[ClerkClaims], Depends(get_optional_claims)],
) -> ClerkClaims:
    if not claims:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return claims


def get_org_and_member(
    db: Session,
    clerk_org_id: str,
    user_clerk_id: str,
) -> tuple[Organization, OrganizationMember]:
    """Load org (by clerk_org_id) and membership; raise 403 if not member."""
    org = db.query(Organization).filter(Organization.clerk_org_id == clerk_org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    user = db.query(User).filter(User.clerk_id == user_clerk_id).first()
    if not user:
        raise HTTPException(status_code=403, detail="User not in database")
    member = db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org.id,
        OrganizationMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this organization")
    return org, member


_ROLE_ORDER = {Role.member: 0, Role.admin: 1, Role.owner: 2}


def _check_role(member_role: Optional[str], min_role: Role) -> None:
    if not member_role:
        raise HTTPException(status_code=403, detail="No org role")
    try:
        r = Role(member_role) if isinstance(member_role, str) else member_role
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid role")
    if _ROLE_ORDER.get(r, 0) < _ROLE_ORDER.get(min_role, 0):
        raise HTTPException(status_code=403, detail=f"Requires {min_role.value} or higher")


def rbac_require_org(
    claims: Annotated[ClerkClaims, Depends(require_auth)],
    db: Annotated[Session, Depends(get_db)],
    min_role: Role = Role.member,
) -> tuple[ClerkClaims, Organization, OrganizationMember]:
    """Require auth and org context; optionally enforce min role. Syncs org/user from Clerk on first use."""
    if not claims.org_id:
        raise HTTPException(status_code=403, detail="Organization context required")
    from clerk_sync import ensure_org_user_synced
    ensure_org_user_synced(
        db,
        clerk_org_id=claims.org_id,
        clerk_user_id=claims.sub,
        org_name=claims.org_slug or "",
        org_role=claims.org_role or "member",
    )
    org, member = get_org_and_member(db, claims.org_id, claims.sub)
    _check_role(getattr(member, "role", None), min_role)
    return claims, org, member
