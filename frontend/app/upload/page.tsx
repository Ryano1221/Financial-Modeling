"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { fetchApi, CONNECTION_MESSAGE } from "@/lib/api";
import { formatCurrencyPerSF, formatDateISO, formatMonths, formatPercent, formatRSF } from "@/lib/format";
import type { LeaseExtraction, ScenarioInput, RentStep } from "@/lib/types";

function formatExtractedDisplay(key: string, value: unknown): string {
  if (value == null) return "—";
  if (key === "rsf") return formatRSF(typeof value === "number" ? value : Number(value));
  if (key === "commencement" || key === "expiration") return formatDateISO(String(value));
  if (key === "free_rent") return formatMonths(typeof value === "number" ? value : Number(value));
  if (key === "ti_allowance" || key === "base_opex_psf_yr" || key === "base_year_opex_psf_yr") return formatCurrencyPerSF(typeof value === "number" ? value : Number(value));
  if (key === "opex_growth" || key === "discount_rate_annual") return formatPercent(typeof value === "number" ? value : Number(value));
  return String(value);
}

const PENDING_SCENARIO_KEY = "lease_deck_pending_scenario";

function extractionToScenario(ext: LeaseExtraction, edits: Record<string, string | number>): ScenarioInput {
  const num = (key: string) => {
    const v = edits[key];
    if (v !== undefined && v !== "") return Number(v);
    return undefined;
  };
  const str = (key: string) => {
    const v = edits[key];
    if (v !== undefined && v !== "") return String(v);
    return undefined;
  };

  const rsf = num("rsf") ?? (ext.rsf?.value as number) ?? 10000;
  const commencement = str("commencement") ?? (ext.commencement?.value as string) ?? "2026-01-01";
  const expiration = str("expiration") ?? (ext.expiration?.value as string) ?? "2031-01-01";
  let rent_steps: RentStep[] = Array.isArray(ext.rent_steps_table?.value) ? ext.rent_steps_table.value as RentStep[] : [];
  if (rent_steps.length === 0) rent_steps = [{ start: 0, end: 59, rate_psf_yr: 30 }];
  const free_rent_months = num("free_rent") ?? (ext.free_rent?.value as number) ?? 0;
  const ti_allowance_psf = num("ti_allowance") ?? (ext.ti_allowance?.value as number) ?? 0;
  const base_opex_psf_yr = num("base_opex_psf_yr") ?? 10;
  const base_year_opex_psf_yr = num("base_year_opex_psf_yr") ?? 10;
  const opex_growth = num("opex_growth") ?? 0.03;
  const discount_rate_annual = num("discount_rate_annual") ?? 0.08;

  return {
    name: "From lease upload",
    rsf,
    commencement,
    expiration,
    rent_steps,
    free_rent_months,
    ti_allowance_psf,
    opex_mode: "nnn",
    base_opex_psf_yr,
    base_year_opex_psf_yr,
    opex_growth,
    discount_rate_annual,
  };
}

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<LeaseExtraction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string | number>>({});

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setExtraction(null);
    setError(null);
    setEdits({});
  }, []);

  const upload = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetchApi("/upload_lease", { method: "POST", body: formData });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const data: LeaseExtraction = await res.json();
      setExtraction(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : CONNECTION_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [file]);

  const setEdit = useCallback((key: string, value: string | number) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const createScenario = useCallback(() => {
    if (!extraction) return;
    const scenario = extractionToScenario(extraction, edits);
    try {
      sessionStorage.setItem(PENDING_SCENARIO_KEY, JSON.stringify(scenario));
      router.push("/");
    } catch (e) {
      setError("Could not save scenario");
    }
  }, [extraction, edits, router]);

  return (
    <main className="app-container pt-24 pb-14 max-w-5xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-slate-400 hover:text-slate-100 text-sm">
          ← Back to scenarios
        </Link>
        <h1 className="text-2xl font-semibold text-slate-100 tracking-tight">Lease intake (AI)</h1>
      </div>

      <section className="surface-card p-5 mb-6">
        <h2 className="heading-section mb-4">Upload lease PDF</h2>
        <p className="text-sm text-slate-300 mb-4">
          Upload a lease document to extract key terms. Review and edit the extracted fields, then create a scenario.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={onFileChange}
            className="text-sm text-slate-300"
          />
          <button
            type="button"
            onClick={upload}
            disabled={!file || loading}
            className="btn-premium btn-premium-primary disabled:opacity-50"
          >
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
        {error && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-red-200 flex-1">{error}</p>
            <button
              type="button"
              onClick={upload}
              disabled={!file || loading}
              className="btn-premium btn-premium-primary disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}
      </section>

      {extraction && (
        <section className="surface-card p-5 mb-6">
          <h2 className="heading-section mb-4">Review & edit</h2>
          <p className="text-sm text-slate-300 mb-4">
            Edit any field below, then click &quot;Create scenario from extraction&quot; to add this as a scenario on the main page.
          </p>

          <div className="space-y-4">
            {[
              { key: "rsf", label: "RSF", ext: extraction.rsf, type: "number" as const },
              { key: "commencement", label: "Commencement", ext: extraction.commencement, type: "text" as const },
              { key: "expiration", label: "Expiration", ext: extraction.expiration, type: "text" as const },
              { key: "free_rent", label: "Free rent (months)", ext: extraction.free_rent, type: "number" as const },
              { key: "ti_allowance", label: "TI allowance ($/SF)", ext: extraction.ti_allowance, type: "number" as const },
              { key: "base_opex_psf_yr", label: "Base opex ($/SF/yr)", ext: null, type: "number" as const, default: 10 },
              { key: "base_year_opex_psf_yr", label: "Base year opex ($/SF/yr)", ext: null, type: "number" as const, default: 10 },
              { key: "opex_growth", label: "Opex growth", ext: null, type: "number" as const, default: 0.03 },
              { key: "discount_rate_annual", label: "Discount rate (annual)", ext: null, type: "number" as const, default: 0.08 },
            ].map(({ key, label, ext, type, default: def }) => (
              <div key={key} className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-slate-300/20 pb-4">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase mb-1">Extracted</p>
                  <p className="text-sm text-slate-200">
                    {ext?.value != null ? formatExtractedDisplay(key, ext.value) : "—"}
                    {ext?.confidence != null && (
                      <span className="ml-2 text-slate-400">({Math.round((ext.confidence ?? 0) * 100)}%)</span>
                    )}
                  </p>
                  {ext?.citation && (
                    <p className="text-xs text-slate-400 mt-1 italic">&quot;{ext.citation.slice(0, 120)}…&quot;</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase mb-1">Your value</p>
                  <input
                    type={type}
                    value={edits[key] !== undefined ? edits[key] : (ext?.value ?? def ?? "")}
                    onChange={(e) => setEdit(key, type === "number" ? (e.target.value === "" ? (def as number) ?? 0 : Number(e.target.value)) : e.target.value)}
                    className="input-premium"
                  />
                </div>
              </div>
            ))}

            {/* Rent steps table */}
            <div className="border-b border-slate-300/20 pb-4">
              <p className="text-xs font-medium text-slate-400 uppercase mb-1">Rent steps (table)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-200">
                    {Array.isArray(extraction.rent_steps_table?.value) && extraction.rent_steps_table.value.length > 0
                      ? JSON.stringify(extraction.rent_steps_table.value)
                      : extraction.rent_steps_table?.value != null
                        ? String(extraction.rent_steps_table.value)
                        : "—"}
                  </p>
                  {extraction.rent_steps_table?.citation && (
                    <p className="text-xs text-slate-400 mt-1 italic">&quot;{extraction.rent_steps_table.citation.slice(0, 120)}…&quot;</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-400">Use as-is in scenario. Edit on main page if needed.</p>
                </div>
              </div>
            </div>

            {/* Text-only fields */}
            {[
              { key: "opex_terms", label: "Opex terms", ext: extraction.opex_terms },
              { key: "base_year_language", label: "Base year language", ext: extraction.base_year_language },
              { key: "parking_terms", label: "Parking terms", ext: extraction.parking_terms },
              { key: "options", label: "Options", ext: extraction.options },
              { key: "termination_clauses", label: "Termination clauses", ext: extraction.termination_clauses },
            ].map(({ key, label, ext }) => (
              <div key={key} className="border-b border-slate-300/20 pb-4">
                <p className="text-xs font-medium text-slate-400 uppercase mb-1">{label}</p>
                <p className="text-sm text-slate-200">{ext?.value != null ? String(ext.value) : "—"}</p>
                {ext?.citation && <p className="text-xs text-slate-400 mt-1 italic">&quot;{ext.citation.slice(0, 150)}…&quot;</p>}
              </div>
            ))}
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={createScenario}
              className="btn-premium btn-premium-primary"
            >
              Create scenario from extraction
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
