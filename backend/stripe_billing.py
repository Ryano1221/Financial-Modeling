"""
Stripe subscription billing.

Plans:
  Starter    $10/mo  → STRIPE_PRICE_STARTER
  Pro        $20/mo  → STRIPE_PRICE_PRO
  Enterprise $50/mo  → STRIPE_PRICE_ENTERPRISE  (30-day free trial)

Legacy metered billing (runs + PDF exports) is preserved via meter events.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")

# Subscription price IDs (set these in your environment after creating prices)
STRIPE_PRICE_STARTER = os.environ.get("STRIPE_PRICE_STARTER")
STRIPE_PRICE_PRO = os.environ.get("STRIPE_PRICE_PRO")
STRIPE_PRICE_ENTERPRISE = os.environ.get("STRIPE_PRICE_ENTERPRISE")

# Legacy metered billing meter names
METER_RUNS = os.environ.get("STRIPE_METER_RUNS", "runs")
METER_PDF_EXPORTS = os.environ.get("STRIPE_METER_PDF_EXPORTS", "pdf_exports")

PRICE_ID_MAP = {
    "starter": STRIPE_PRICE_STARTER,
    "pro": STRIPE_PRICE_PRO,
    "enterprise": STRIPE_PRICE_ENTERPRISE,
}


def get_stripe():
    if not STRIPE_SECRET_KEY:
        return None
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        return stripe
    except ImportError:
        return None


# ── Customer management ───────────────────────────────────────────────────────

def ensure_customer(org_id: str, org_name: str, existing_stripe_id: Optional[str] = None) -> Optional[str]:
    """Create or return Stripe Customer ID for the org."""
    st = get_stripe()
    if not st:
        return None
    if existing_stripe_id:
        return existing_stripe_id
    cust = st.Customer.create(name=org_name, metadata={"org_id": org_id})
    return cust.id


# ── Subscription management ───────────────────────────────────────────────────

def create_subscription(
    stripe_customer_id: str,
    plan_tier: str,
    trial: bool = False,
) -> Optional[dict]:
    """
    Create a Stripe subscription for the given plan tier.
    Returns dict with subscription_id, status, trial_end.
    """
    st = get_stripe()
    if not st or not stripe_customer_id:
        return None

    price_id = PRICE_ID_MAP.get(plan_tier)
    if not price_id:
        # No price configured in env — return a mock for dev
        return _mock_subscription(plan_tier, trial)

    kwargs = dict(
        customer=stripe_customer_id,
        items=[{"price": price_id}],
        payment_behavior="default_incomplete",
        payment_settings={"save_default_payment_method": "on_subscription"},
        expand=["latest_invoice.payment_intent"],
    )

    if trial and plan_tier == "enterprise":
        kwargs["trial_period_days"] = 30

    try:
        sub = st.Subscription.create(**kwargs)
        trial_end = None
        if sub.get("trial_end"):
            trial_end = datetime.fromtimestamp(sub["trial_end"], tz=timezone.utc)
        return {
            "subscription_id": sub.id,
            "status": sub.status,
            "trial_end": trial_end,
            "client_secret": (
                sub.get("latest_invoice", {})
                .get("payment_intent", {})
                .get("client_secret")
            ),
        }
    except Exception as e:
        print(f"[stripe] create_subscription error: {e}")
        return None


def cancel_subscription(stripe_subscription_id: str) -> bool:
    """Cancel a subscription at period end."""
    st = get_stripe()
    if not st or not stripe_subscription_id:
        return False
    try:
        st.Subscription.modify(stripe_subscription_id, cancel_at_period_end=True)
        return True
    except Exception as e:
        print(f"[stripe] cancel_subscription error: {e}")
        return False


def change_subscription_plan(stripe_subscription_id: str, new_tier: str) -> Optional[dict]:
    """Upgrade or downgrade an existing subscription."""
    st = get_stripe()
    if not st or not stripe_subscription_id:
        return None

    price_id = PRICE_ID_MAP.get(new_tier)
    if not price_id:
        return _mock_subscription(new_tier, False)

    try:
        sub = st.Subscription.retrieve(stripe_subscription_id)
        item_id = sub["items"]["data"][0]["id"]
        updated = st.Subscription.modify(
            stripe_subscription_id,
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="always_invoice",
            cancel_at_period_end=False,
        )
        return {
            "subscription_id": updated.id,
            "status": updated.status,
            "trial_end": None,
        }
    except Exception as e:
        print(f"[stripe] change_subscription_plan error: {e}")
        return None


def get_subscription(stripe_subscription_id: str) -> Optional[dict]:
    """Fetch current subscription details."""
    st = get_stripe()
    if not st or not stripe_subscription_id:
        return None
    try:
        sub = st.Subscription.retrieve(stripe_subscription_id)
        trial_end = None
        if sub.get("trial_end"):
            trial_end = datetime.fromtimestamp(sub["trial_end"], tz=timezone.utc)
        return {
            "subscription_id": sub.id,
            "status": sub.status,
            "trial_end": trial_end,
            "current_period_end": datetime.fromtimestamp(sub["current_period_end"], tz=timezone.utc) if sub.get("current_period_end") else None,
        }
    except Exception as e:
        print(f"[stripe] get_subscription error: {e}")
        return None


def create_billing_portal_session(stripe_customer_id: str, return_url: str) -> Optional[str]:
    """Return a Stripe Customer Portal URL for self-service billing management."""
    st = get_stripe()
    if not st or not stripe_customer_id:
        return None
    try:
        session = st.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=return_url,
        )
        return session.url
    except Exception as e:
        print(f"[stripe] create_billing_portal_session error: {e}")
        return None


def create_checkout_session(
    stripe_customer_id: str,
    plan_tier: str,
    success_url: str,
    cancel_url: str,
    trial: bool = False,
) -> Optional[str]:
    """Return a Stripe Checkout URL for a new subscription."""
    st = get_stripe()
    if not st:
        return None

    price_id = PRICE_ID_MAP.get(plan_tier)
    if not price_id:
        return None

    kwargs = dict(
        customer=stripe_customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
    )
    if trial and plan_tier == "enterprise":
        kwargs["subscription_data"] = {"trial_period_days": 30}

    try:
        session = st.checkout.Session.create(**kwargs)
        return session.url
    except Exception as e:
        print(f"[stripe] create_checkout_session error: {e}")
        return None


# ── Webhook event handling ────────────────────────────────────────────────────

def parse_webhook_event(payload: bytes, sig_header: str):
    """Verify and parse a Stripe webhook event. Returns event or raises."""
    st = get_stripe()
    if not st:
        raise ValueError("Stripe not configured")
    return st.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)


def handle_subscription_event(event: dict) -> Optional[dict]:
    """
    Parse a Stripe subscription webhook event into a db-update dict.
    Returns: {subscription_id, status, trial_end, plan_tier} or None
    """
    sub = event.get("data", {}).get("object", {})
    if not sub:
        return None

    status = sub.get("status", "none")
    trial_end_ts = sub.get("trial_end")
    trial_end = (
        datetime.fromtimestamp(trial_end_ts, tz=timezone.utc) if trial_end_ts else None
    )

    # Determine plan tier from price ID
    items = sub.get("items", {}).get("data", [])
    price_id = items[0]["price"]["id"] if items else None
    tier = _tier_from_price_id(price_id)

    return {
        "subscription_id": sub.get("id"),
        "status": status,
        "trial_end": trial_end,
        "plan_tier": tier,
    }


def _tier_from_price_id(price_id: Optional[str]) -> str:
    if not price_id:
        return "starter"
    reverse = {v: k for k, v in PRICE_ID_MAP.items() if v}
    return reverse.get(price_id, "starter")


# ── Legacy metered billing ────────────────────────────────────────────────────

def report_usage_runs(stripe_customer_id: str, quantity: int = 1) -> bool:
    st = get_stripe()
    if not st or not stripe_customer_id:
        return False
    try:
        st.billing.MeterEvent.create(
            event_name=METER_RUNS,
            payload={"value": str(quantity), "stripe_customer_id": stripe_customer_id},
        )
        return True
    except Exception:
        return False


def report_usage_pdf_export(stripe_customer_id: str, quantity: int = 1) -> bool:
    st = get_stripe()
    if not st or not stripe_customer_id:
        return False
    try:
        st.billing.MeterEvent.create(
            event_name=METER_PDF_EXPORTS,
            payload={"value": str(quantity), "stripe_customer_id": stripe_customer_id},
        )
        return True
    except Exception:
        return False


# ── Dev mock ─────────────────────────────────────────────────────────────────

def _mock_subscription(plan_tier: str, trial: bool) -> dict:
    """Return a fake subscription for dev environments without Stripe keys."""
    trial_end = None
    if trial and plan_tier == "enterprise":
        trial_end = datetime.now(timezone.utc) + timedelta(days=30)
    return {
        "subscription_id": f"mock_sub_{plan_tier}",
        "status": "trialing" if trial_end else "active",
        "trial_end": trial_end,
        "client_secret": None,
    }
