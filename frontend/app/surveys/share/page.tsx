"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { computeSurveyMonthlyOccupancyCost } from "@/lib/surveys/engine";
import { parseSurveysShareData } from "@/lib/surveys/export";

function formatDate(value: string): string {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || "").trim() || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function SurveysShareContent() {
  const searchParams = useSearchParams();
  const payload = useMemo(() => parseSurveysShareData(searchParams.get("data")), [searchParams]);

  if (!payload) {
    return (
      <main className="app-container pt-24 pb-16">
        <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Survey Share</p>
          <h1 className="heading-section mb-2">Invalid Or Missing Share Data</h1>
          <p className="text-sm text-slate-300">This survey share link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container pt-24 pb-16">
      <section className="mx-auto max-w-6xl border border-white/20 bg-black/35 p-6">
        <p className="heading-kicker mb-2">Survey Share</p>
        <h1 className="heading-section mb-1">Survey Comparison</h1>
        <p className="text-sm text-slate-300 mb-4">
          {payload.branding.brokerageName} | {payload.branding.clientName} | Prepared by {payload.branding.preparedBy} | Report Date {payload.branding.reportDate}
        </p>

        <div className="overflow-x-auto border border-white/15">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/70 border-b border-white/20">
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Building</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Address</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Suite/Floor</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Direct/Sublease</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Sublessor</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Sublease Exp.</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Lease Type</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">RSF</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Base Rent</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">OpEx</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Monthly Occupancy</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payload.entries.map((entry, idx) => {
                const cost = computeSurveyMonthlyOccupancyCost(entry);
                const suiteFloor = [entry.suite, entry.floor].filter(Boolean).join(" / ");
                return (
                  <tr key={entry.id} className={`border-b border-white/10 ${idx % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                    <td className="py-2 px-2 text-white">{entry.buildingName || entry.sourceDocumentName}</td>
                    <td className="py-2 px-2 text-slate-300">{entry.address || "-"}</td>
                    <td className="py-2 px-2 text-slate-300">{suiteFloor || "-"}</td>
                    <td className="py-2 px-2 text-slate-300">{entry.occupancyType}</td>
                    <td className="py-2 px-2 text-slate-300">{entry.sublessor || "-"}</td>
                    <td className="py-2 px-2 text-slate-300">{entry.subleaseExpirationDate || "-"}</td>
                    <td className="py-2 px-2 text-slate-300">{entry.leaseType}</td>
                    <td className="py-2 px-2 text-slate-200">{entry.availableSqft.toLocaleString("en-US")}</td>
                    <td className="py-2 px-2 text-slate-200">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(entry.baseRentPsfAnnual)}
                    </td>
                    <td className="py-2 px-2 text-slate-200">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(entry.opexPsfAnnual)}
                    </td>
                    <td className="py-2 px-2 text-cyan-100">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cost.totalMonthly)}
                    </td>
                    <td className="py-2 px-2 text-slate-300">{entry.needsReview ? "Needs Review" : "Ready"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-400 mt-4">
          Generated {formatDate(payload.generatedAtIso.slice(0, 10))}. Review status reflects extraction confidence and manual confirmation.
        </p>
      </section>
    </main>
  );
}

export default function SurveysSharePage() {
  return (
    <Suspense
      fallback={
        <main className="app-container pt-24 pb-16">
          <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
            <p className="text-sm text-slate-300">Loading shared survey...</p>
          </section>
        </main>
      }
    >
      <SurveysShareContent />
    </Suspense>
  );
}
