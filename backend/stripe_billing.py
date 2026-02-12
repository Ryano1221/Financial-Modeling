"""
Stripe usage-based billing.
Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID (metered price for runs + PDF exports).
Create a Stripe Customer per org (store stripe_customer_id on Organization).
Report usage: runs and pdf_exports as meter events (Stripe Billing Meters) or
via subscription item usage (legacy Usage Records).
"""
from __future__ import annotations

import os
from typing import Optional

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
# Stripe Price ID for metered billing (create in Dashboard or via API)
STRIPE_METERED_PRICE_ID = os.environ.get("STRIPE_METERED_PRICE_ID")
# Or use Billing Meters (Stripe 2024): meter event names
METER_RUNS = os.environ.get("STRIPE_METER_RUNS", "runs")
METER_PDF_EXPORTS = os.environ.get("STRIPE_METER_PDF_EXPORTS", "pdf_exports")


def get_stripe():
    if not STRIPE_SECRET_KEY:
        return None
    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        return stripe
    except ImportError:
        return None


def ensure_customer(org_id: str, org_name: str, existing_stripe_id: Optional[str] = None) -> Optional[str]:
    """Create or return Stripe Customer ID for the org."""
    st = get_stripe()
    if not st:
        return None
    if existing_stripe_id:
        return existing_stripe_id
    cust = st.Customer.create(name=org_name, metadata={"org_id": org_id})
    return cust.id


def report_usage_runs(stripe_customer_id: str, quantity: int = 1) -> bool:
    """Report run usage for metered billing."""
    st = get_stripe()
    if not st or not stripe_customer_id:
        return False
    try:
        # Option A: Subscription Item usage (if org has subscription with metered price)
        # st.UsageRecord.create(subscription_item_id=..., quantity=quantity, timestamp=int(time.time()))
        # Option B: Billing Meter Events (Stripe 2024)
        st.billing.MeterEvent.create(
            event_name=METER_RUNS,
            payload={"value": str(quantity), "stripe_customer_id": stripe_customer_id},
        )
        return True
    except Exception:
        return False


def report_usage_pdf_export(stripe_customer_id: str, quantity: int = 1) -> bool:
    """Report PDF export usage for metered billing."""
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
