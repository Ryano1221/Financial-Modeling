"use client";

import { useState } from "react";
import { PLANS_STATIC, PLAN_COLORS, PlanTier, startCheckout } from "@/lib/billing";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which feature triggered the modal — shown as context */
  feature?: string;
  /** Message explaining why the upgrade is needed */
  message?: string;
  /** Current plan tier of the org */
  currentPlan?: PlanTier;
  /** Which tier to highlight as recommended */
  recommendedTier?: PlanTier;
}

export default function UpgradeModal({
  isOpen,
  onClose,
  feature,
  message,
  currentPlan = "starter",
  recommendedTier = "pro",
}: UpgradeModalProps) {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpgrade = async (tier: PlanTier, trial = false) => {
    setLoading(tier);
    setError(null);
    try {
      const url = await startCheckout(tier, trial);
      if (url) {
        window.location.href = url;
      } else {
        setError("Unable to start checkout. Please try again or contact support.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  const tiers: PlanTier[] = ["starter", "pro", "enterprise"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-400 text-xl">⚡</span>
                <span className="text-sm font-medium text-slate-300 uppercase tracking-wider">
                  {feature ? `Upgrade to unlock ${feature}` : "Upgrade your plan"}
                </span>
              </div>
              <h2 className="text-2xl font-bold">
                {message ?? "This feature requires a higher plan."}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-2xl leading-none mt-1"
            >
              ×
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {tiers.map((tier) => {
              const plan = PLANS_STATIC[tier];
              const colors = PLAN_COLORS[tier];
              const isRecommended = tier === recommendedTier;
              const isCurrent = tier === currentPlan;
              const isEnterprise = tier === "enterprise";

              return (
                <div
                  key={tier}
                  className={`relative rounded-xl border-2 p-5 flex flex-col transition-all ${
                    isEnterprise
                      ? "bg-gradient-to-b from-slate-900 to-slate-800 text-white border-slate-600"
                      : `${colors.bg} ${colors.border} text-slate-900`
                  } ${isRecommended ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                >
                  {isRecommended && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                      RECOMMENDED
                    </div>
                  )}
                  {isEnterprise && (
                    <div className="absolute -top-3 right-4 bg-amber-500 text-slate-900 text-xs font-bold px-3 py-1 rounded-full">
                      30-DAY FREE TRIAL
                    </div>
                  )}

                  <div className="mb-4">
                    <h3
                      className={`font-bold text-lg ${isEnterprise ? "text-white" : "text-slate-900"}`}
                    >
                      {plan.name}
                    </h3>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span
                        className={`text-3xl font-black ${isEnterprise ? "text-amber-400" : "text-slate-900"}`}
                      >
                        ${plan.price_monthly / 100}
                      </span>
                      <span
                        className={`text-sm ${isEnterprise ? "text-slate-400" : "text-slate-500"}`}
                      >
                        /month
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-2 mb-6 flex-1">
                    {plan.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm">
                        <span className={isEnterprise ? "text-amber-400" : "text-blue-600"}>
                          ✓
                        </span>
                        <span className={isEnterprise ? "text-slate-300" : "text-slate-700"}>
                          {h}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <div className="w-full text-center py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-500">
                      Current plan
                    </div>
                  ) : isEnterprise ? (
                    <button
                      onClick={() => handleUpgrade("enterprise", true)}
                      disabled={loading !== null}
                      className="w-full py-2.5 rounded-lg text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 transition-colors disabled:opacity-60"
                    >
                      {loading === "enterprise"
                        ? "Loading…"
                        : "Start Free Trial"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(tier)}
                      disabled={loading !== null}
                      className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-60 ${colors.cta}`}
                    >
                      {loading === tier ? "Loading…" : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <p className="mt-4 text-center text-sm text-red-600">{error}</p>
          )}

          <p className="mt-6 text-center text-xs text-slate-400">
            Secure payment via Stripe · Cancel anytime · No hidden fees
          </p>
        </div>
      </div>
    </div>
  );
}
