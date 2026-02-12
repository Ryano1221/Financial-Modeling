"""
Webhooks: Stripe (billing events), Clerk (user/org sync).
"""
from __future__ import annotations

import os
import json
from fastapi import APIRouter, Request, HTTPException, Header, Depends
from sqlalchemy.orm import Session

from db.session import get_db

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(None, alias="Stripe-Signature"),
):
    """Verify Stripe signature and handle subscription/customer events. Return 200 to acknowledge."""
    from stripe_billing import STRIPE_WEBHOOK_SECRET, get_stripe
    payload = await request.body()
    if not STRIPE_WEBHOOK_SECRET or not stripe_signature:
        raise HTTPException(status_code=400, detail="Webhook secret or signature missing")
    stripe = get_stripe()
    if not stripe:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")
    # Optional: handle customer.subscription.created/updated to link subscription to org
    if event["type"].startswith("customer.subscription."):
        # event["data"]["object"] has customer, subscription id, etc.
        pass
    return {"received": True}


@router.post("/webhooks/clerk")
async def clerk_webhook(
    request: Request,
    svix_id: str | None = Header(None, alias="Svix-Id"),
    svix_timestamp: str | None = Header(None, alias="Svix-Timestamp"),
    svix_signature: str | None = Header(None, alias="Svix-Signature"),
    db: Session = Depends(get_db),
):
    """Verify Svix signature and sync user/org/member from Clerk events."""
    from clerk_sync import ensure_org_user_synced
    payload = await request.body()
    secret = os.environ.get("CLERK_WEBHOOK_SECRET")
    if not secret or not svix_signature:
        raise HTTPException(status_code=400, detail="CLERK_WEBHOOK_SECRET or Svix-Signature missing")
    try:
        import svix
        wh = svix.Webhook(secret)
        wh.verify(payload, {"svix-id": svix_id, "svix-timestamp": svix_timestamp, "svix-signature": svix_signature})
    except ImportError:
        raise HTTPException(status_code=503, detail="Install svix to verify Clerk webhooks")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid webhook: {e}")
    data = json.loads(payload)
    typ = data.get("type")
    if typ == "organizationMembership.created" or typ == "organizationMembership.updated":
        obj = data.get("data", {})
        org_id = obj.get("organization", {}).get("id") if isinstance(obj.get("organization"), dict) else None
        org_slug = obj.get("organization", {}).get("slug") if isinstance(obj.get("organization"), dict) else None
        org_name = obj.get("organization", {}).get("name") or org_slug or ""
        user_id = obj.get("public_user_data", {}).get("user_id") if isinstance(obj.get("public_user_data"), dict) else None
        role = (obj.get("role") or "member").lower()
        if org_id and user_id:
            # We need user email/name from Clerk API or from user.created; for now sync with minimal data
            ensure_org_user_synced(db, org_id, user_id, org_name=org_name, org_slug=org_slug, org_role=role)
    elif typ == "user.created" or typ == "user.updated":
        from clerk_sync import ensure_user_synced
        obj = data.get("data", {})
        user_id = obj.get("id")
        email = obj.get("email_addresses", [{}])[0].get("email_address") if obj.get("email_addresses") else None
        name = f"{obj.get('first_name', '')} {obj.get('last_name', '')}".strip() or None
        if user_id:
            ensure_user_synced(db, user_id, user_email=email, user_name=name)
    elif typ == "organization.created" or typ == "organization.updated":
        from clerk_sync import ensure_org_synced
        obj = data.get("data", {})
        org_id = obj.get("id")
        name = obj.get("name") or ""
        slug = obj.get("slug")
        if org_id:
            ensure_org_synced(db, org_id, org_name=name, org_slug=slug)
    return {"received": True}
