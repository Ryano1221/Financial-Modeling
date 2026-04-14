/**
 * Billing utilities — plan definitions mirroring the backend.
 * Feature gating is enforced server-side; this is for UI hints only.
 */

export type PlanTier = "starter" | "pro" | "enterprise";

export interface PlanLimits {
  name: string;
  price_monthly: number; // cents
  max_deals: number;
  max_scenarios_per_deal: number;
  max_team_members: number;
  max_pdf_exports_per_month: number;
  max_ai_extractions_per_month: number;
  advanced_compute: boolean;
  ai_extraction: boolean;
  white_label_branding: boolean;
  surveys_module: boolean;
  obligations_module: boolean;
  sublease_recovery_module: boolean;
  completed_leases_module: boolean;
  api_access: boolean;
  priority_support: boolean;
  excel_export: boolean;
  trial_days: number;
  highlights: string[];
}

export interface OrgPlanInfo {
  plan_tier: PlanTier;
  subscription_status: string;
  is_trial: boolean;
  trial_days_remaining: number | null;
  trial_ends_at: string | null;
  plan: PlanLimits;
  usage: {
    monthly_pdf_exports: number;
    monthly_ai_extractions: number;
  };
}

export const PLAN_COLORS: Record<PlanTier, { bg: string; border: string; badge: string; cta: string }> = {
  starter: {
    bg: "bg-slate-50",
    border: "border-slate-200",
    badge: "bg-slate-100 text-slate-700",
    cta: "bg-slate-800 hover:bg-slate-700 text-white",
  },
  pro: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    badge: "bg-blue-600 text-white",
    cta: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  enterprise: {
    bg: "bg-gradient-to-b from-slate-900 to-slate-800",
    border: "border-slate-600",
    badge: "bg-amber-500 text-slate-900",
    cta: "bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold",
  },
};

export const PLANS_STATIC: Record<PlanTier, PlanLimits> = {
  starter: {
    name: "Starter",
    price_monthly: 1000,
    max_deals: 3,
    max_scenarios_per_deal: 5,
    max_team_members: 1,
    max_pdf_exports_per_month: 2,
    max_ai_extractions_per_month: 0,
    advanced_compute: false,
    ai_extraction: false,
    white_label_branding: false,
    surveys_module: false,
    obligations_module: false,
    sublease_recovery_module: false,
    completed_leases_module: false,
    api_access: false,
    priority_support: false,
    excel_export: true,
    trial_days: 0,
    highlights: [
      "3 active deals",
      "5 scenarios per deal",
      "Basic NPV modeling",
      "2 PDF exports / month",
      "Excel export",
      "1 user seat",
    ],
  },
  pro: {
    name: "Pro",
    price_monthly: 2000,
    max_deals: 15,
    max_scenarios_per_deal: -1,
    max_team_members: 3,
    max_pdf_exports_per_month: 10,
    max_ai_extractions_per_month: 5,
    advanced_compute: true,
    ai_extraction: true,
    white_label_branding: false,
    surveys_module: true,
    obligations_module: true,
    sublease_recovery_module: false,
    completed_leases_module: true,
    api_access: false,
    priority_support: false,
    excel_export: true,
    trial_days: 0,
    highlights: [
      "15 active deals",
      "Unlimited scenarios",
      "Advanced NPV + multi-discount modeling",
      "10 PDF exports / month",
      "AI lease extraction (5 docs/mo)",
      "3 team seats",
      "Surveys & Obligations modules",
      "Completed Leases tracker",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price_monthly: 5000,
    max_deals: -1,
    max_scenarios_per_deal: -1,
    max_team_members: -1,
    max_pdf_exports_per_month: -1,
    max_ai_extractions_per_month: -1,
    advanced_compute: true,
    ai_extraction: true,
    white_label_branding: true,
    surveys_module: true,
    obligations_module: true,
    sublease_recovery_module: true,
    completed_leases_module: true,
    api_access: true,
    priority_support: true,
    excel_export: true,
    trial_days: 30,
    highlights: [
      "Unlimited deals & scenarios",
      "Unlimited PDF exports",
      "Unlimited AI lease extraction",
      "White-label branded reports",
      "Unlimited team seats",
      "All modules incl. Sublease Recovery",
      "API access",
      "Priority support",
    ],
  },
};

export function formatLimit(val: number): string {
  return val === -1 ? "Unlimited" : String(val);
}

export function getPlanBadge(tier: PlanTier, isTrial: boolean): string {
  if (isTrial) return "Enterprise Trial";
  return PLANS_STATIC[tier]?.name ?? tier;
}

export async function fetchOrgPlan(): Promise<OrgPlanInfo | null> {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8010";
    const res = await fetch(`${backendUrl}/api/v1/billing/plan`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function startCheckout(tier: PlanTier, trial = false): Promise<string | null> {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8010";
    const res = await fetch(`${backendUrl}/api/v1/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan_tier: tier, start_trial: trial }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.checkout_url ?? null;
  } catch {
    return null;
  }
}

export async function openBillingPortal(): Promise<string | null> {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8010";
    const res = await fetch(`${backendUrl}/api/v1/billing/portal`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.portal_url ?? null;
  } catch {
    return null;
  }
}
