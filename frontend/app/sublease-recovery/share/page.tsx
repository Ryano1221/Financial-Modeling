"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseSubleaseRecoveryShareData } from "@/lib/sublease-recovery/export";

function formatDate(value: string): string {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || "").trim() || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(decimal: number): string {
  return `${(Number(decimal || 0) * 100).toFixed(1)}%`;
}

function SubleaseRecoveryShareContent() {
  const searchParams = useSearchParams();
  const envelope = useMemo(
    () => parseSubleaseRecoveryShareData(searchParams.get("data")),
    [searchParams],
  );

  if (!envelope) {
    return (
      <main className="app-container pt-24 pb-16">
        <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Sublease Recovery Share</p>
          <h1 className="heading-section mb-2">Invalid Or Missing Share Data</h1>
          <p className="text-sm text-slate-300">This sublease recovery share link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container pt-24 pb-16">
      <section className="mx-auto max-w-6xl border border-white/20 bg-black/35 p-6">
        <p className="heading-kicker mb-2">Sublease Recovery Share</p>
        <h1 className="heading-section mb-1">Sublease Recovery Analysis</h1>
        <p className="text-sm text-slate-300 mb-4">
          {envelope.branding.brokerageName} | {envelope.branding.clientName} | Prepared by {envelope.branding.preparedBy || "-"} | Report Date {envelope.branding.reportDate}
        </p>
        <div className="mb-4 border border-white/15 bg-black/25 p-3 text-sm">
          <p className="text-slate-200">
            <span className="text-slate-400">Premises:</span> {envelope.payload.existing.premises}
          </p>
          <p className="text-slate-200">
            <span className="text-slate-400">RSF:</span> {envelope.payload.existing.rsf.toLocaleString("en-US")}
          </p>
          <p className="text-slate-200">
            <span className="text-slate-400">Term:</span> {formatDate(envelope.payload.existing.commencementDate)} to {formatDate(envelope.payload.existing.expirationDate)} ({envelope.payload.existing.leaseType})
          </p>
        </div>

        <div className="overflow-x-auto border border-white/15">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/70 border-b border-white/20">
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Scenario</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Subtenant</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Source</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Remaining Obligation</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Sublease Recovery</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Sublease Costs</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Net Recovery</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Net Obligation</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Recovery %</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">NPV</th>
              </tr>
            </thead>
            <tbody>
              {envelope.payload.scenarios.map((row, idx) => (
                <tr key={`${row.scenarioName}-${idx}`} className={`border-b border-white/10 ${idx % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                  <td className="py-2 px-2 text-white">{row.scenarioName}</td>
                  <td className="py-2 px-2 text-slate-300">{row.subtenantName || "-"}</td>
                  <td className="py-2 px-2 text-slate-300">
                    {row.sourceType === "proposal_import"
                      ? (row.sourceDocumentName || "Imported proposal")
                      : "Manual"}
                  </td>
                  <td className="py-2 px-2 text-slate-100">{formatCurrency(row.totalRemainingObligation)}</td>
                  <td className="py-2 px-2 text-slate-100">{formatCurrency(row.totalSubleaseRecovery)}</td>
                  <td className="py-2 px-2 text-slate-100">{formatCurrency(row.totalSubleaseCosts)}</td>
                  <td className="py-2 px-2 text-cyan-100">{formatCurrency(row.netSubleaseRecovery)}</td>
                  <td className="py-2 px-2 text-cyan-100">{formatCurrency(row.netObligation)}</td>
                  <td className="py-2 px-2 text-slate-200">{formatPercent(row.recoveryPercent)}</td>
                  <td className="py-2 px-2 text-slate-200">{formatCurrency(row.npv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 mt-4">
          Generated {formatDate(envelope.generatedAtIso.slice(0, 10))}. Figures are scenario-level summaries for client review.
        </p>
      </section>
    </main>
  );
}

export default function SubleaseRecoverySharePage() {
  return (
    <Suspense
      fallback={
        <main className="app-container pt-24 pb-16">
          <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
            <p className="text-sm text-slate-300">Loading shared sublease recovery analysis...</p>
          </section>
        </main>
      }
    >
      <SubleaseRecoveryShareContent />
    </Suspense>
  );
}
