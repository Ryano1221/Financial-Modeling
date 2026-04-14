"use client";

import { useEffect, useState } from "react";
import { fetchOrgPlan, OrgPlanInfo, openBillingPortal } from "@/lib/billing";

export default function TrialBanner() {
  const [plan, setPlan] = useState<OrgPlanInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [portalError, setPortalError] = useState("");

  useEffect(() => {
    fetchOrgPlan().then(setPlan);
  }, []);

  if (!plan || dismissed) return null;

  // Show trial banner
  if (plan.is_trial && plan.trial_days_remaining !== null) {
    const days = plan.trial_days_remaining;
    const urgent = days <= 5;

    return (
      <div
        className={`flex items-center justify-between px-4 py-2 text-sm font-medium ${
          urgent
            ? "bg-red-600 text-white"
            : "bg-amber-500 text-slate-900"
        }`}
      >
        <div className="flex items-center gap-2">
          <span>{urgent ? "⚠️" : "🚀"}</span>
          <span>
            {days === 0
              ? "Your Enterprise free trial ends today."
              : `Your Enterprise free trial ends in ${days} day${days === 1 ? "" : "s"}.`}{" "}
            Subscribe now to keep full access.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setPortalError("");
              setLoadingPortal(true);
              try {
                const url = await openBillingPortal();
                if (url) window.location.href = url;
              } catch (err) {
                setPortalError(err instanceof Error ? err.message : "Unable to open billing portal right now.");
              }
              setLoadingPortal(false);
            }}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
              urgent
                ? "bg-white text-red-600 hover:bg-red-50"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {loadingPortal ? "Loading…" : "Subscribe Now"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
        {portalError ? <span className="ml-2 text-xs">{portalError}</span> : null}
      </div>
    );
  }

  // Show past-due / canceled warning
  if (
    plan.subscription_status === "past_due" ||
    plan.subscription_status === "unpaid"
  ) {
    return (
      <div className="flex items-center justify-between px-4 py-2 text-sm font-medium bg-red-600 text-white">
        <span>
          ⚠️ Your payment is past due. Update your payment method to restore full access.
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setPortalError("");
              setLoadingPortal(true);
              try {
                const url = await openBillingPortal();
                if (url) window.location.href = url;
              } catch (err) {
                setPortalError(err instanceof Error ? err.message : "Unable to open billing portal right now.");
              }
              setLoadingPortal(false);
            }}
            className="px-3 py-1 rounded-md text-xs font-bold bg-white text-red-600 hover:bg-red-50"
          >
            Update Payment
          </button>
          <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
        {portalError ? <span className="ml-2 text-xs">{portalError}</span> : null}
      </div>
    );
  }

  return null;
}
