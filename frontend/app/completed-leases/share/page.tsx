"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseCompletedLeaseShareData } from "@/lib/completed-leases/export";

function formatDate(value: string): string {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value || "").trim() || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function CompletedLeasesShareContent() {
  const searchParams = useSearchParams();
  const envelope = useMemo(
    () => parseCompletedLeaseShareData(searchParams.get("data")),
    [searchParams],
  );

  if (!envelope) {
    return (
      <main className="app-container pt-24 pb-16">
        <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
          <p className="heading-kicker mb-2">Completed Leases Share</p>
          <h1 className="heading-section mb-2">Invalid Or Missing Share Data</h1>
          <p className="text-sm text-slate-300">This completed lease abstract share link is invalid or expired.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-container pt-24 pb-16">
      <section className="mx-auto max-w-6xl border border-white/20 bg-black/35 p-6">
        <p className="heading-kicker mb-2">Completed Leases Share</p>
        <h1 className="heading-section mb-1">{envelope.payload.title}</h1>
        <p className="text-sm text-slate-300 mb-4">
          {envelope.branding.brokerageName} | {envelope.branding.clientName} | Prepared by {envelope.branding.preparedBy || "-"} | Report Date {envelope.branding.reportDate}
        </p>

        <div className="overflow-x-auto border border-white/15">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/70 border-b border-white/20">
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Term</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {envelope.payload.fields.map((row, idx) => (
                <tr key={`${row.label}-${idx}`} className={`border-b border-white/10 ${idx % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                  <td className="py-2 px-2 text-slate-200">{row.label}</td>
                  <td className="py-2 px-2 text-white">{row.value || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 overflow-x-auto border border-white/15">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900/70 border-b border-white/20">
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Type</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Document</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Uploaded</th>
                <th className="text-left py-2 px-2 text-slate-200 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {envelope.payload.sourceDocuments.map((doc, idx) => (
                <tr key={`${doc.fileName}-${idx}`} className={`border-b border-white/10 ${idx % 2 === 1 ? "bg-white/[0.02]" : ""}`}>
                  <td className="py-2 px-2 text-slate-300">{doc.kind === "amendment" ? "Amendment" : "Lease"}</td>
                  <td className="py-2 px-2 text-slate-100">{doc.fileName}</td>
                  <td className="py-2 px-2 text-slate-300">{formatDate(doc.uploadedAtIso.slice(0, 10))}</td>
                  <td className="py-2 px-2 text-slate-300">{doc.controllingStatus === "controlling" ? "Controlling" : "Reference"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {envelope.payload.overrideNotes.length > 0 ? (
          <div className="mt-4 border border-white/15 bg-black/25 p-3">
            <p className="heading-kicker mb-2">Override Audit Notes</p>
            <ul className="text-xs text-slate-300 space-y-1">
              {envelope.payload.overrideNotes.map((note, idx) => (
                <li key={`${note}-${idx}`}>• {note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-slate-400 mt-4">
          Generated {formatDate(envelope.generatedAtIso.slice(0, 10))}. Abstract reflects controlling lease terms with amendment overrides applied.
        </p>
      </section>
    </main>
  );
}

export default function CompletedLeasesSharePage() {
  return (
    <Suspense
      fallback={
        <main className="app-container pt-24 pb-16">
          <section className="mx-auto max-w-4xl border border-white/20 bg-black/35 p-6">
            <p className="text-sm text-slate-300">Loading shared completed lease abstract...</p>
          </section>
        </main>
      }
    >
      <CompletedLeasesShareContent />
    </Suspense>
  );
}
