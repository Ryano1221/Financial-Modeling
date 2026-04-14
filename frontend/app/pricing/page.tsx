"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS_STATIC, PLAN_COLORS, PlanTier, startCheckout } from "@/lib/billing";

const FEATURE_ROWS = [
  { label: "Active deals", key: "max_deals", format: (v: number) => v === -1 ? "Unlimited" : String(v) },
  { label: "Scenarios per deal", key: "max_scenarios_per_deal", format: (v: number) => v === -1 ? "Unlimited" : String(v) },
  { label: "Team seats", key: "max_team_members", format: (v: number) => v === -1 ? "Unlimited" : String(v) },
  { label: "PDF exports / month", key: "max_pdf_exports_per_month", format: (v: number) => v === -1 ? "Unlimited" : String(v) },
  { label: "AI lease extractions / mo", key: "max_ai_extractions_per_month", format: (v: number) => v === -1 ? "Unlimited" : v === 0 ? "—" : String(v) },
  { label: "Basic NPV modeling", key: "excel_export", format: () => "✓" },
  { label: "Advanced NPV & multi-discount", key: "advanced_compute", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Excel export", key: "excel_export", format: () => "✓" },
  { label: "AI lease extraction", key: "ai_extraction", format: (v: boolean) => v ? "✓" : "—" },
  { label: "White-label branding", key: "white_label_branding", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Surveys module", key: "surveys_module", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Obligations module", key: "obligations_module", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Completed Leases", key: "completed_leases_module", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Sublease Recovery", key: "sublease_recovery_module", format: (v: boolean) => v ? "✓" : "—" },
  { label: "API access", key: "api_access", format: (v: boolean) => v ? "✓" : "—" },
  { label: "Priority support", key: "priority_support", format: (v: boolean | undefined) => v ? "✓" : "—" },
];

const FAQS = [
  {
    q: "Can I change plans at any time?",
    a: "Yes. Upgrades take effect immediately with prorated billing. Downgrades apply at the next billing cycle.",
  },
  {
    q: "How does the 30-day Enterprise trial work?",
    a: "You get full Enterprise access — unlimited deals, AI extraction, white-label reports, all modules — free for 30 days. No credit card required to start. You'll be prompted to add a payment method before the trial ends.",
  },
  {
    q: "What happens if I hit my plan's deal limit?",
    a: "You'll see an upgrade prompt in the app. Existing deals remain accessible — you just can't create new ones until you upgrade or archive old ones.",
  },
  {
    q: "Is billing monthly or annual?",
    a: "Plans are billed monthly. Annual options with a discount are coming soon.",
  },
  {
    q: "Do you offer refunds?",
    a: "Yes — reach out within 7 days of a charge if you're unsatisfied and we'll make it right.",
  },
  {
    q: "What is AI lease extraction?",
    a: "Upload a lease PDF or DOCX and our AI will automatically extract key terms — rent schedules, TI allowances, free rent, options, and more — directly into your scenario model.",
  },
];

export default function PricingPage() {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCTA = async (tier: PlanTier, trial = false) => {
    setLoading(tier);
    setError(null);
    const url = await startCheckout(tier, trial);
    if (url) {
      window.location.href = url;
    } else {
      // Fallback: redirect to sign-up
      window.location.href = "/sign-up";
      setError(null);
    }
    setLoading(null);
  };

  const tiers: PlanTier[] = ["starter", "pro", "enterprise"];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-sm">
            CRE
          </div>
          <span className="font-bold text-white text-lg">The CRE Model</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-slate-400 hover:text-white text-sm transition-colors">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm px-4 py-1.5 rounded-full mb-6">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Simple, transparent pricing
        </div>
        <h1 className="text-5xl font-black mb-4 leading-tight">
          Built for CRE professionals.
          <br />
          <span className="text-blue-400">Priced like it.</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          From solo brokers to full teams — model leases, extract terms with AI,
          and deliver white-label reports that win deals.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => {
            const plan = PLANS_STATIC[tier];
            const isEnterprise = tier === "enterprise";
            const isPro = tier === "pro";

            return (
              <div
                key={tier}
                className={`relative rounded-2xl border flex flex-col ${
                  isEnterprise
                    ? "bg-gradient-to-b from-slate-800 to-slate-900 border-slate-600 shadow-xl shadow-slate-900"
                    : isPro
                    ? "bg-slate-900 border-blue-500"
                    : "bg-slate-900 border-slate-700"
                }`}
              >
                {isPro && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full tracking-wide">
                    MOST POPULAR
                  </div>
                )}
                {isEnterprise && (
                  <div className="absolute -top-3.5 right-5 bg-amber-500 text-slate-900 text-xs font-bold px-4 py-1 rounded-full tracking-wide">
                    30-DAY FREE TRIAL
                  </div>
                )}

                <div className="p-7 flex-1 flex flex-col">
                  {/* Plan name & price */}
                  <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                          isEnterprise
                            ? "bg-amber-500/20 text-amber-400"
                            : isPro
                            ? "bg-blue-600/20 text-blue-400"
                            : "bg-slate-700 text-slate-400"
                        }`}
                      >
                        {plan.name.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span
                        className={`text-5xl font-black ${
                          isEnterprise ? "text-amber-400" : "text-white"
                        }`}
                      >
                        ${plan.price_monthly / 100}
                      </span>
                      <span className="text-slate-400 text-sm">/month</span>
                    </div>
                    {isEnterprise && (
                      <p className="text-emerald-400 text-sm mt-1.5 font-medium">
                        First 30 days free — no card required
                      </p>
                    )}
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 text-sm ${
                            isEnterprise ? "text-amber-400" : isPro ? "text-blue-400" : "text-slate-400"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="text-slate-300 text-sm">{h}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={() => handleCTA(tier, isEnterprise)}
                    disabled={loading !== null}
                    className={`w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-60 ${
                      isEnterprise
                        ? "bg-amber-500 hover:bg-amber-400 text-slate-900"
                        : isPro
                        ? "bg-blue-600 hover:bg-blue-500 text-white"
                        : "bg-slate-700 hover:bg-slate-600 text-white"
                    }`}
                  >
                    {loading === tier
                      ? "Loading…"
                      : isEnterprise
                      ? "Start Free Trial"
                      : `Get ${plan.name}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="mt-4 text-center text-sm text-red-400">{error}</p>
        )}
      </div>

      {/* Feature comparison table */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold text-center mb-8 text-white">
          Compare all features
        </h2>
        <div className="rounded-2xl overflow-hidden border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800">
                <th className="text-left py-4 px-6 text-slate-400 font-medium w-1/3">
                  Feature
                </th>
                {tiers.map((t) => (
                  <th key={t} className="py-4 px-4 text-center font-bold text-white">
                    {PLANS_STATIC[t].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row, i) => (
                <tr
                  key={`${row.key}-${i}`}
                  className={`border-b border-slate-800/60 ${
                    i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/40"
                  }`}
                >
                  <td className="py-3.5 px-6 text-slate-300">{row.label}</td>
                  {tiers.map((t) => {
                    const plan = PLANS_STATIC[t];
                    const val = (plan as Record<string, unknown>)[row.key];
                    const formatted = row.format(val as never);
                    return (
                      <td
                        key={t}
                        className={`py-3.5 px-4 text-center font-medium ${
                          formatted === "—"
                            ? "text-slate-600"
                            : formatted === "✓"
                            ? t === "enterprise"
                              ? "text-amber-400"
                              : "text-blue-400"
                            : "text-white"
                        }`}
                      >
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-bold text-center mb-10 text-white">
          Frequently asked questions
        </h2>
        <div className="space-y-4">
          {FAQS.map((faq) => (
            <details
              key={faq.q}
              className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
            >
              <summary className="px-6 py-4 cursor-pointer flex items-center justify-between text-white font-medium select-none list-none">
                {faq.q}
                <span className="text-slate-500 group-open:rotate-180 transition-transform text-lg">
                  ↓
                </span>
              </summary>
              <p className="px-6 pb-5 text-slate-400 text-sm leading-relaxed">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* CTA banner */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 py-16 px-6 text-center">
        <h2 className="text-3xl font-black text-white mb-3">
          Ready to win more deals?
        </h2>
        <p className="text-blue-100 mb-8 max-w-xl mx-auto">
          Start your 30-day Enterprise trial — no credit card required.
          Full access to every feature on day one.
        </p>
        <button
          onClick={() => handleCTA("enterprise", true)}
          disabled={loading !== null}
          className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-black px-8 py-4 rounded-xl text-lg transition-colors disabled:opacity-60"
        >
          {loading === "enterprise" ? "Loading…" : "Start Free Trial →"}
        </button>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} The CRE Model. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/docs" className="hover:text-slate-300 transition-colors">
              Docs
            </Link>
            <Link href="/security" className="hover:text-slate-300 transition-colors">
              Security
            </Link>
            <Link href="/contact" className="hover:text-slate-300 transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
