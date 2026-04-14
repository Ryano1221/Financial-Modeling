"""
Feature gating by plan tier.

Starter  ($10/m) — entry-level: limited deals, basic compute, minimal exports
Pro      ($20/m) — growth: more deals, AI extraction, team seats, surveys
Enterprise ($50/m, 30-day trial) — unlimited everything, white-label, all modules
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from fastapi import HTTPException, status

from db.models import PlanTier, SubscriptionStatus


# ── Plan definitions ──────────────────────────────────────────────────────────

@dataclass
class PlanLimits:
    name: str
    price_monthly: int          # cents
    max_deals: int              # -1 = unlimited
    max_scenarios_per_deal: int # -1 = unlimited
    max_team_members: int       # -1 = unlimited
    max_pdf_exports_per_month: int   # -1 = unlimited
    max_ai_extractions_per_month: int  # -1 = unlimited
    # Feature flags
    advanced_compute: bool      # canonical compute / multi-discount NPV
    ai_extraction: bool         # AI-powered lease term extraction
    white_label_branding: bool  # custom logo/colors on reports
    surveys_module: bool
    obligations_module: bool
    sublease_recovery_module: bool
    completed_leases_module: bool
    api_access: bool
    priority_support: bool
    excel_export: bool
    trial_days: int             # 0 = no trial
    highlights: list[str] = field(default_factory=list)


PLANS: dict[str, PlanLimits] = {
    PlanTier.starter.value: PlanLimits(
        name="Starter",
        price_monthly=1000,
        max_deals=3,
        max_scenarios_per_deal=5,
        max_team_members=1,
        max_pdf_exports_per_month=2,
        max_ai_extractions_per_month=0,
        advanced_compute=False,
        ai_extraction=False,
        white_label_branding=False,
        surveys_module=False,
        obligations_module=False,
        sublease_recovery_module=False,
        completed_leases_module=False,
        api_access=False,
        priority_support=False,
        excel_export=True,
        trial_days=0,
        highlights=[
            "3 active deals",
            "5 scenarios per deal",
            "Basic NPV modeling",
            "2 PDF exports / month",
            "Excel export",
            "1 user seat",
        ],
    ),
    PlanTier.pro.value: PlanLimits(
        name="Pro",
        price_monthly=2000,
        max_deals=15,
        max_scenarios_per_deal=-1,
        max_team_members=3,
        max_pdf_exports_per_month=10,
        max_ai_extractions_per_month=5,
        advanced_compute=True,
        ai_extraction=True,
        white_label_branding=False,
        surveys_module=True,
        obligations_module=True,
        sublease_recovery_module=False,
        completed_leases_module=True,
        api_access=False,
        priority_support=False,
        excel_export=True,
        trial_days=0,
        highlights=[
            "15 active deals",
            "Unlimited scenarios",
            "Advanced NPV + multi-discount modeling",
            "10 PDF exports / month",
            "AI lease extraction (5 docs/mo)",
            "3 team seats",
            "Surveys & Obligations modules",
            "Completed Leases tracker",
        ],
    ),
    PlanTier.enterprise.value: PlanLimits(
        name="Enterprise",
        price_monthly=5000,
        max_deals=-1,
        max_scenarios_per_deal=-1,
        max_team_members=-1,
        max_pdf_exports_per_month=-1,
        max_ai_extractions_per_month=-1,
        advanced_compute=True,
        ai_extraction=True,
        white_label_branding=True,
        surveys_module=True,
        obligations_module=True,
        sublease_recovery_module=True,
        completed_leases_module=True,
        api_access=True,
        priority_support=True,
        excel_export=True,
        trial_days=30,
        highlights=[
            "Unlimited deals & scenarios",
            "Unlimited PDF exports",
            "Unlimited AI lease extraction",
            "White-label branded reports",
            "Unlimited team seats",
            "All modules incl. Sublease Recovery",
            "API access",
            "Priority support",
        ],
    ),
}

# enterprise trial mirrors enterprise limits
PLANS[PlanTier.free_trial.value] = PlanLimits(
    **{
        **PLANS[PlanTier.enterprise.value].__dict__,
        "name": "Enterprise Trial",
        "price_monthly": 0,
    }
)


# ── Org plan resolver ─────────────────────────────────────────────────────────

def effective_plan(org) -> PlanLimits:
    """Return the effective plan limits for an org, respecting trial status."""
    tier = getattr(org, "plan_tier", PlanTier.starter.value)
    status_val = getattr(org, "subscription_status", SubscriptionStatus.none.value)
    trial_ends = getattr(org, "trial_ends_at", None)

    # Active trial → enterprise limits
    if trial_ends and datetime.now(timezone.utc) < trial_ends.replace(tzinfo=timezone.utc):
        return PLANS[PlanTier.free_trial.value]

    # Canceled / past-due → downgrade to starter
    if status_val in (SubscriptionStatus.canceled.value, SubscriptionStatus.past_due.value, SubscriptionStatus.unpaid.value):
        return PLANS[PlanTier.starter.value]

    return PLANS.get(tier, PLANS[PlanTier.starter.value])


def is_on_active_trial(org) -> bool:
    trial_ends = getattr(org, "trial_ends_at", None)
    if not trial_ends:
        return False
    return datetime.now(timezone.utc) < trial_ends.replace(tzinfo=timezone.utc)


def days_left_on_trial(org) -> Optional[int]:
    trial_ends = getattr(org, "trial_ends_at", None)
    if not trial_ends:
        return None
    delta = trial_ends.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)
    return max(0, delta.days)


# ── Guard helpers ─────────────────────────────────────────────────────────────

def require_feature(org, feature: str, label: str = None) -> None:
    """Raise 403 if org's plan doesn't have the feature flag set."""
    plan = effective_plan(org)
    if not getattr(plan, feature, False):
        plan_name = label or feature.replace("_", " ").title()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PLAN_LIMIT",
                "feature": feature,
                "message": f"{plan_name} is not available on the {plan.name} plan.",
                "upgrade_required": True,
                "current_plan": plan.name,
            },
        )


def require_deal_limit(org, current_deal_count: int) -> None:
    plan = effective_plan(org)
    if plan.max_deals != -1 and current_deal_count >= plan.max_deals:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "DEAL_LIMIT",
                "feature": "max_deals",
                "message": f"Your {plan.name} plan is limited to {plan.max_deals} active deals.",
                "upgrade_required": True,
                "current_plan": plan.name,
                "limit": plan.max_deals,
            },
        )


def require_scenario_limit(org, current_scenario_count: int) -> None:
    plan = effective_plan(org)
    if plan.max_scenarios_per_deal != -1 and current_scenario_count >= plan.max_scenarios_per_deal:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "SCENARIO_LIMIT",
                "feature": "max_scenarios_per_deal",
                "message": f"Your {plan.name} plan is limited to {plan.max_scenarios_per_deal} scenarios per deal.",
                "upgrade_required": True,
                "current_plan": plan.name,
                "limit": plan.max_scenarios_per_deal,
            },
        )


def require_pdf_export_limit(org) -> None:
    plan = effective_plan(org)
    if plan.max_pdf_exports_per_month == -1:
        return
    _maybe_reset_monthly_usage(org)
    used = getattr(org, "monthly_pdf_exports", 0) or 0
    if used >= plan.max_pdf_exports_per_month:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PDF_EXPORT_LIMIT",
                "feature": "max_pdf_exports_per_month",
                "message": f"You've used all {plan.max_pdf_exports_per_month} PDF exports for this month on the {plan.name} plan.",
                "upgrade_required": True,
                "current_plan": plan.name,
                "limit": plan.max_pdf_exports_per_month,
                "used": used,
            },
        )


def require_ai_extraction_limit(org) -> None:
    plan = effective_plan(org)
    if not plan.ai_extraction:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "AI_EXTRACTION_UNAVAILABLE",
                "feature": "ai_extraction",
                "message": f"AI lease extraction is not available on the {plan.name} plan.",
                "upgrade_required": True,
                "current_plan": plan.name,
            },
        )
    if plan.max_ai_extractions_per_month == -1:
        return
    _maybe_reset_monthly_usage(org)
    used = getattr(org, "monthly_ai_extractions", 0) or 0
    if used >= plan.max_ai_extractions_per_month:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "AI_EXTRACTION_LIMIT",
                "feature": "max_ai_extractions_per_month",
                "message": f"You've used all {plan.max_ai_extractions_per_month} AI extractions for this month on the {plan.name} plan.",
                "upgrade_required": True,
                "current_plan": plan.name,
                "limit": plan.max_ai_extractions_per_month,
                "used": used,
            },
        )


def _maybe_reset_monthly_usage(org) -> None:
    """Reset monthly counters if we've rolled into a new month."""
    reset_at = getattr(org, "usage_reset_at", None)
    now = datetime.now(timezone.utc)
    if reset_at is None or (now.year, now.month) != (reset_at.year, reset_at.month):
        org.monthly_pdf_exports = 0
        org.monthly_ai_extractions = 0
        org.usage_reset_at = now
