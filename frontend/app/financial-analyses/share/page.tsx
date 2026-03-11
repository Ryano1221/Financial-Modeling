"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseFinancialAnalysesShareData } from "@/lib/financial-analyses/share";

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function FinancialAnalysesShareContent() {
  const searchParams = useSearchParams();
  const envelope = useMemo(
    () => parseFinancialAnalysesShareData(searchParams.get("data")),
    [searchParams],
  );

  if (!envelope) {
    return (
      <main className="app-container pt-24 pb-16">
        <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Financial Analyses Share</p>
          <h1 className="heading-section mb-2">Invalid Or Missing Share Data</h1>
          <p className="text-sm text-slate-300">This financial analysis share link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container pt-24 pb-16">
      <section className="mx-auto max-w-6xl border border-white/20 bg-black/35 p-6">
        <p className="heading-kicker mb-2">Financial Analyses Share</p>
        <h1 className="heading-section mb-1">Lease Financial Analysis Summary</h1>
        <p className="text-sm text-slate-300 mb-4">
          {envelope.branding.brokerageName} | {envelope.branding.clientName} | Prepared by {envelope.branding.preparedBy || "-"} | Report Date {envelope.branding.reportDate}
        </p>
        {envelope.payload.equalizedWindow ? (
          <p className="text-xs text-slate-400 mb-3">
            Equalized window: {formatDate(envelope.payload.equalizedWindow.start)} to {formatDate(envelope.payload.equalizedWindow.end)} ({envelope.payload.equalizedWindow.source}).
          </p>
        ) : null}

        <div className="overflow-x-auto border border-white/15">
          <table className="w-full min-w-[1200px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/70 border-b border-white/20">
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Scenario</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Document</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Building</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Suite/Floor</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Address</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Lease Type</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">RSF</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Term (Mo.)</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Commencement</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Expiration</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Total Obligation</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">NPV Cost</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Avg Cost/SF/YR</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Equalized Avg/SF/YR</th>
              </tr>
            </thead>
            <tbody>
              {envelope.payload.scenarios.map((row, idx) => (
                <tr key={row.id} className={`border-b border-white/10 ${idx % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                  <td className="py-2 px-2 text-white">{row.scenarioName}</td>
                  <td className="py-2 px-2 text-slate-300">{row.documentType || "-"}</td>
                  <td className="py-2 px-2 text-slate-300">{row.buildingName || "-"}</td>
                  <td className="py-2 px-2 text-slate-300">{row.suiteFloor || "-"}</td>
                  <td className="py-2 px-2 text-slate-300">{row.address || "-"}</td>
                  <td className="py-2 px-2 text-slate-300">{row.leaseType || "-"}</td>
                  <td className="py-2 px-2 text-slate-200">{formatNumber(row.rsf)}</td>
                  <td className="py-2 px-2 text-slate-200">{formatNumber(row.termMonths)}</td>
                  <td className="py-2 px-2 text-slate-300">{formatDate(row.commencementDate)}</td>
                  <td className="py-2 px-2 text-slate-300">{formatDate(row.expirationDate)}</td>
                  <td className="py-2 px-2 text-slate-100">{formatCurrency(row.totalObligation)}</td>
                  <td className="py-2 px-2 text-slate-100">{formatCurrency(row.npvCost)}</td>
                  <td className="py-2 px-2 text-cyan-100">{formatCurrency(row.avgCostPsfYear)}</td>
                  <td className="py-2 px-2 text-cyan-100">{formatCurrency(row.equalizedAvgCostPsfYear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 mt-4">
          Generated {formatDate(envelope.generatedAtIso.slice(0, 10))}. Values reflect the latest saved scenario assumptions.
        </p>
      </section>
    </main>
  );
}

export default function FinancialAnalysesSharePage() {
  return (
    <Suspense
      fallback={
        <main className="app-container pt-24 pb-16">
          <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
            <p className="text-sm text-slate-300">Loading shared financial analysis...</p>
          </section>
        </main>
      }
    >
      <FinancialAnalysesShareContent />
    </Suspense>
  );
}
