"use client";

import { useState, useCallback, useEffect } from "react";
import { ScenarioList } from "@/components/ScenarioList";
import { ScenarioForm, defaultScenarioInput } from "@/components/ScenarioForm";
import { ComparisonTable, type ComparisonRow, type SortKey, type SortDir } from "@/components/ComparisonTable";
import { Charts, type ChartRow } from "@/components/Charts";
import { baseUrl, getAuthHeaders } from "@/lib/api";
import { ExtractUpload } from "@/components/ExtractUpload";
import { Diagnostics } from "@/components/Diagnostics";
import { FeatureTiles } from "@/components/FeatureTiles";
import { UploadExtractCard } from "@/components/UploadExtractCard";
import { ResultsActionsCard } from "@/components/ResultsActionsCard";
import { Footer } from "@/components/Footer";
import type {
  ScenarioWithId,
  CashflowResult,
  ExtractionResponse,
  GenerateScenariosRequest,
  GenerateScenariosResponse,
  ScenarioInput,
  BrandConfig,
} from "@/lib/types";
const PENDING_SCENARIO_KEY = "lease_deck_pending_scenario";
const BRAND_ID_STORAGE_KEY = "lease_deck_brand_id";

type ReportErrorState = { statusCode: number; message: string; reportId?: string } | null;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normalize scenario for API: ensure free_rent_months is int (backend accepts int or list; we always send int). */
function scenarioToPayload(s: ScenarioWithId): Omit<ScenarioWithId, "id"> {
  const { id: _id, ...rest } = s;
  const raw = (rest as { free_rent_months?: number | number[] }).free_rent_months;
  const free_rent_months =
    Array.isArray(raw) ? Math.max(0, raw.length) : typeof raw === "number" ? Math.max(0, Math.floor(raw)) : rest.free_rent_months ?? 0;
  const payload = { ...rest, free_rent_months };
  if (process.env.NODE_ENV === "development") {
    if (typeof payload.free_rent_months !== "number" || !Number.isInteger(payload.free_rent_months)) {
      console.error("[scenarioToPayload] free_rent_months must be integer; got", payload.free_rent_months);
    }
  }
  return payload;
}

export default function Home() {
  const [scenarios, setScenarios] = useState<ScenarioWithId[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CashflowResult | { error: string }>>({});
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("avg_cost_psf_year");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [renewalRelocateExpanded, setRenewalRelocateExpanded] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtractWarnings, setLastExtractWarnings] = useState<string[] | null>(null);
  const [lastExtractSource, setLastExtractSource] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandConfig[]>([]);
  const [brandId, setBrandId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const s = localStorage.getItem(BRAND_ID_STORAGE_KEY);
      if (s) return s;
    }
    return "default";
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<ReportErrorState>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<ReportErrorState>(null);
  const [reportMeta, setReportMeta] = useState({
    prepared_for: "",
    prepared_by: "",
    proposal_name: "",
    property_name: "",
    confidential: true,
  });

  const selectedScenario = scenarios.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    fetch(`${baseUrl}/brands`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: BrandConfig[]) => setBrands(Array.isArray(data) ? data : []))
      .catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && brandId) {
      localStorage.setItem(BRAND_ID_STORAGE_KEY, brandId);
    }
  }, [brandId]);

  const handleExtractSuccess = useCallback((data: ExtractionResponse) => {
    const scenarioWithId: ScenarioWithId = { id: nextId(), ...data.scenario };
    setScenarios((prev) => [...prev, scenarioWithId]);
    setSelectedId(scenarioWithId.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[scenarioWithId.id];
      return next;
    });
    setLastExtractWarnings(data.warnings.length ? data.warnings : null);
    setLastExtractSource(data.source);
    setExtractError(null);
  }, []);

  const handleExtractError = useCallback((message: string) => {
    setExtractError(message);
    setLastExtractWarnings(null);
    setLastExtractSource(null);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_SCENARIO_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_SCENARIO_KEY);
      const scenarioInput: ScenarioInput = JSON.parse(raw);
      const withId: ScenarioWithId = { id: nextId(), ...scenarioInput };
      setScenarios((prev) => [...prev, withId]);
      setSelectedId(withId.id);
    } catch {
      // ignore invalid or missing
    }
  }, []);

  const addScenario = useCallback(() => {
    const newScenario: ScenarioWithId = {
      id: nextId(),
      ...defaultScenarioInput,
    };
    setScenarios((prev) => [...prev, newScenario]);
    setSelectedId(newScenario.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[newScenario.id];
      return next;
    });
  }, []);

  const duplicateScenario = useCallback(() => {
    if (!selectedScenario) return;
    const copy: ScenarioWithId = {
      ...selectedScenario,
      id: nextId(),
      name: `${selectedScenario.name} (copy)`,
    };
    setScenarios((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[copy.id];
      return next;
    });
  }, [selectedScenario]);

  const deleteScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const duplicateFromList = useCallback((id: string) => {
    const source = scenarios.find((s) => s.id === id);
    if (!source) return;
    const copy: ScenarioWithId = {
      ...source,
      id: nextId(),
      name: `${source.name} (copy)`,
    };
    setScenarios((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[copy.id];
      return next;
    });
  }, [scenarios]);

  const updateScenario = useCallback((updated: ScenarioWithId) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
  }, []);

  const runAnalysis = useCallback(async () => {
    if (scenarios.length === 0) return;
    setLoading(true);
    setResults({});

    const payloads = scenarios.map((s) => ({ id: s.id, payload: scenarioToPayload(s) }));

    const headers = getAuthHeaders();
    const settled = await Promise.allSettled(
      payloads.map(async ({ id, payload }) => {
        const res = await fetch(`${baseUrl}/compute`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        return { id, data: (await res.json()) as CashflowResult };
      })
    );

    const nextResults: Record<string, CashflowResult | { error: string }> = {};
    settled.forEach((outcome, i) => {
      const { id } = payloads[i];
      if (outcome.status === "fulfilled") {
        nextResults[id] = outcome.value.data;
      } else {
        nextResults[id] = {
          error: outcome.reason?.message ?? "Request failed",
        };
      }
    });
    setResults(nextResults);
    setLoading(false);
  }, [scenarios]);

  const exportPdfDeck = useCallback(async () => {
    const withResults = scenarios.filter((s) => {
      const r = results[s.id];
      return r && "term_months" in r;
    });
    if (withResults.length === 0) {
      setExportPdfError("Run analysis first and ensure at least one scenario has results.");
      return;
    }
    setExportPdfLoading(true);
    setExportPdfError(null);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${baseUrl}/reports`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          scenarios: withResults.map((s) => ({
            scenario: scenarioToPayload(s),
            result: results[s.id] as CashflowResult,
          })),
          branding: {},
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: { report_id: string } = await res.json();
      window.open(`${baseUrl}/reports/${data.report_id}/pdf`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setExportPdfError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportPdfLoading(false);
    }
  }, [scenarios, results]);

  const buildReportMeta = useCallback(() => ({
    prepared_for: reportMeta.prepared_for || undefined,
    prepared_by: reportMeta.prepared_by || undefined,
    proposal_name: reportMeta.proposal_name || undefined,
    property_name: reportMeta.property_name || undefined,
    report_date: new Date().toISOString().slice(0, 10),
    confidential: reportMeta.confidential,
  }), [reportMeta]);

  const generateReport = useCallback(async () => {
    if (!selectedScenario) {
      setReportError({ statusCode: 0, message: "Select a scenario first." });
      return;
    }
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`${baseUrl}/report`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          brand_id: brandId,
          scenario: scenarioToPayload(selectedScenario),
          meta: buildReportMeta(),
        }),
      });
      const reportId = res.headers.get("X-Report-ID") ?? undefined;
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : res.statusText;
        setReportError({ statusCode: res.status, message: detail || `HTTP ${res.status}`, reportId });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lease-financial-analysis.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setReportError({ statusCode: 0, message: err instanceof Error ? err.message : "Report generation failed" });
    } finally {
      setReportLoading(false);
    }
  }, [selectedScenario, brandId, buildReportMeta]);

  const previewReport = useCallback(async () => {
    if (!selectedScenario) {
      setPreviewError({ statusCode: 0, message: "Select a scenario first." });
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`${baseUrl}/report/preview`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          brand_id: brandId,
          scenario: scenarioToPayload(selectedScenario),
          meta: buildReportMeta(),
        }),
      });
      const reportId = res.headers.get("X-Report-ID") ?? undefined;
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : res.statusText;
        setPreviewError({ statusCode: res.status, message: detail || `HTTP ${res.status}`, reportId });
        return;
      }
      const html = await res.text();
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch (err) {
      setPreviewError({ statusCode: 0, message: err instanceof Error ? err.message : "Preview failed" });
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedScenario, brandId, buildReportMeta]);

  const buildRenewalVsRelocate = useCallback(async () => {
    setGenerateLoading(true);
    setGenerateError(null);
    const term = 60;
    const req: GenerateScenariosRequest = {
      rsf: 10000,
      target_term_months: term,
      discount_rate_annual: 0.06,
      commencement: "2026-01-01",
      renewal: {
        rent_steps: [{ start: 0, end: term - 1, rate_psf_yr: 30 }],
        free_rent_months: 3,
        ti_allowance_psf: 50,
        opex_mode: "nnn",
        base_opex_psf_yr: 10,
        base_year_opex_psf_yr: 10,
        opex_growth: 0.03,
        parking_spaces: 0,
        parking_cost_monthly_per_space: 0,
      },
      relocation: {
        rent_steps: [{ start: 0, end: term - 1, rate_psf_yr: 32 }],
        free_rent_months: 0,
        ti_allowance_psf: 40,
        moving_costs_total: 100000,
        it_cabling_cost: 25000,
        signage_cost: 5000,
        ffe_cost: 75000,
        legal_cost: 15000,
        downtime_months: 2,
        overlap_months: 1,
        broker_fee: 25000,
        parking_spaces: 0,
        parking_cost_monthly_per_space: 0,
        opex_mode: "nnn",
        base_opex_psf_yr: 10,
        base_year_opex_psf_yr: 10,
        opex_growth: 0.03,
      },
    };
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${baseUrl}/generate_scenarios`, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: GenerateScenariosResponse = await res.json();
      const renewalWithId: ScenarioWithId = { id: nextId(), ...data.renewal };
      const relocationWithId: ScenarioWithId = { id: nextId(), ...data.relocation };
      setScenarios([renewalWithId, relocationWithId]);
      setSelectedId(renewalWithId.id);
      setResults({});
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setGenerateLoading(false);
    }
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(key);
    setSortDir((d) => (key === sortKey ? (d === "asc" ? "desc" : "asc") : "asc"));
  }, [sortKey]);

  const comparisonRows: ComparisonRow[] = scenarios
    .filter((s) => {
      const r = results[s.id];
      return r && "term_months" in r;
    })
    .map((s) => ({
      id: s.id,
      name: s.name,
      result: results[s.id] as CashflowResult,
    }))
    .sort((a, b) => {
      const aVal = a.result[sortKey];
      const bVal = b.result[sortKey];
      const mult = sortDir === "asc" ? 1 : -1;
      return mult * (aVal - bVal);
    });

  const chartData: ChartRow[] = comparisonRows.map((row) => ({
    name: row.name,
    avg_cost_psf_year: row.result.avg_cost_psf_year,
    npv_cost: row.result.npv_cost,
    avg_cost_year: row.result.avg_cost_year,
  }));

  const resultErrors = scenarios
    .map((s) => {
      const r = results[s.id];
      if (r && "error" in r) return { name: s.name, error: r.error };
      return null;
    })
    .filter((x): x is { name: string; error: string } => x !== null);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-end gap-6 px-6 py-4 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <a href="#extract" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
          Upload lease
        </a>
        <a href="/example" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
          Example report
        </a>
      </nav>

      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white flex flex-col justify-center items-center text-center px-6 pt-24">
        <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight leading-tight">
          Institutional-Grade
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">
            Lease Intelligence
          </span>
        </h1>

        <p className="text-zinc-400 text-lg mt-6 max-w-2xl">
          Transform any lease into a structured, branded financial analysis in minutes.
          Built for brokerages, investment firms, and enterprise real estate teams.
        </p>

        <div className="flex gap-6 mt-10 flex-wrap justify-center">
          <a
            href="/example"
            className="px-8 py-4 bg-white text-black font-semibold rounded-full hover:scale-105 transition-transform duration-300"
          >
            View Example Report
          </a>

          <a
            href="#extract"
            className="px-8 py-4 border border-zinc-600 text-white rounded-full hover:bg-zinc-800 transition-colors duration-300"
          >
            Try It Live
          </a>
        </div>
      </div>

      <FeatureTiles />

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-12 md:py-16">
        <section id="extract" className="scroll-mt-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
          {/* Left column: renewal/relocate + upload & extract */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 shadow-xl">
              <button
                type="button"
                onClick={() => setRenewalRelocateExpanded((b) => !b)}
                className="flex items-center justify-between w-full text-left focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded-lg"
              >
                <h2 className="text-xs uppercase tracking-widest text-zinc-500 font-medium">
                  Build renewal vs relocate
                </h2>
                <span className="text-zinc-400">
                  {renewalRelocateExpanded ? "▼" : "▶"}
                </span>
              </button>
              {renewalRelocateExpanded && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-sm text-zinc-400 mb-4">
                    Generate two scenarios (Renewal and Relocation) and load them into the list for comparison.
                  </p>
                  {generateError && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg text-sm">
                      {generateError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={buildRenewalVsRelocate}
                    disabled={generateLoading}
                    className="rounded-full bg-[#3b82f6] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#2563eb] hover:shadow-[0_0_20px_rgba(59,130,246,0.35)] transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
                  >
                    {generateLoading ? "Generating…" : "Generate renewal & relocation scenarios"}
                  </button>
                </div>
              )}
            </section>

            <div id="upload-section">
              <UploadExtractCard>
                <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Extract from document</p>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-lg font-semibold text-white">
                    Upload & extract
                  </h2>
                  {lastExtractSource && (lastExtractSource === "ocr" || lastExtractSource === "pdf_text+ocr") && (
                    <span className="inline-flex items-center rounded bg-amber-500/20 text-amber-300 px-2 py-0.5 text-xs font-medium">
                      OCR
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-400 mb-4">
                  Upload a PDF or DOCX lease; we extract text (and run OCR for scanned PDFs if needed), then AI fills a scenario for review. Always review before running analysis.
                </p>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <label htmlFor="brand-select" className="text-sm font-medium text-zinc-400">
                    Report brand
                  </label>
                  <select
                    id="brand-select"
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    className="rounded-lg border border-white/20 bg-white/5 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent"
                  >
                    {brands.length === 0 && (
                      <option value="default">default</option>
                    )}
                    {brands.map((b) => (
                      <option key={b.brand_id} value={b.brand_id} className="bg-[#111113] text-white">
                        {b.company_name}
                      </option>
                    ))}
                  </select>
                </div>
                <ExtractUpload onSuccess={handleExtractSuccess} onError={handleExtractError} />
                {extractError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                    {extractError}
                  </div>
                )}
                <div className="mt-4">
                  <Diagnostics />
                </div>
                {lastExtractWarnings && lastExtractWarnings.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm">
                    <p className="font-medium text-amber-300 mb-1">Warnings from extraction</p>
                    <ul className="list-disc list-inside text-amber-200/90 space-y-0.5">
                      {lastExtractWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </UploadExtractCard>
            </div>
          </div>

          {/* Right column: scenarios + form + actions */}
          <div className="space-y-6">
            <ResultsActionsCard>
        <ScenarioList
          scenarios={scenarios}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDuplicate={duplicateFromList}
          onDelete={deleteScenario}
        />

        <ScenarioForm
          scenario={selectedScenario}
          onUpdate={updateScenario}
          onAddScenario={addScenario}
          onDuplicateScenario={duplicateScenario}
        />

        <section className="pt-6 border-t border-white/10">
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Run analysis</p>
          <h2 className="text-lg font-semibold text-white mb-2">Compute & report</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Compute all scenarios and compare results. One API call per scenario; failed scenarios are reported below.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={runAnalysis}
              disabled={loading || scenarios.length === 0}
              className="rounded-full bg-[#3b82f6] text-white px-5 py-2.5 text-sm font-medium hover:bg-[#2563eb] hover:shadow-[0_0_20px_rgba(59,130,246,0.35)] transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {loading ? "Running…" : "Run analysis"}
            </button>
            <button
              type="button"
              onClick={exportPdfDeck}
              disabled={exportPdfLoading || scenarios.length === 0}
              className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {exportPdfLoading ? "Exporting…" : "Export PDF deck"}
            </button>
            <button
              type="button"
              onClick={generateReport}
              disabled={reportLoading || !selectedScenario}
              className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {reportLoading ? "Generating…" : "Generate Report"}
            </button>
            <button
              type="button"
              onClick={previewReport}
              disabled={previewLoading || !selectedScenario}
              className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {previewLoading ? "Opening…" : "Preview Report"}
            </button>
          </div>
          <div className="mt-6 pt-4 border-t border-white/10">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-3">Report meta (for PDF cover)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Prepared for</span>
                <input
                  type="text"
                  value={reportMeta.prepared_for}
                  onChange={(e) => setReportMeta((m) => ({ ...m, prepared_for: e.target.value }))}
                  className="rounded-lg border border-white/20 bg-white/5 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent placeholder:text-zinc-500"
                  placeholder="Client or recipient"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Prepared by</span>
                <input
                  type="text"
                  value={reportMeta.prepared_by}
                  onChange={(e) => setReportMeta((m) => ({ ...m, prepared_by: e.target.value }))}
                  className="rounded-lg border border-white/20 bg-white/5 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent placeholder:text-zinc-500"
                  placeholder="Analyst or firm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Proposal name</span>
                <input
                  type="text"
                  value={reportMeta.proposal_name}
                  onChange={(e) => setReportMeta((m) => ({ ...m, proposal_name: e.target.value }))}
                  className="rounded-lg border border-white/20 bg-white/5 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent placeholder:text-zinc-500"
                  placeholder="Used in PDF filename"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-zinc-500">Property name</span>
                <input
                  type="text"
                  value={reportMeta.property_name}
                  onChange={(e) => setReportMeta((m) => ({ ...m, property_name: e.target.value }))}
                  className="rounded-lg border border-white/20 bg-white/5 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent placeholder:text-zinc-500"
                  placeholder="Building or address"
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reportMeta.confidential}
                  onChange={(e) => setReportMeta((m) => ({ ...m, confidential: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-[#3b82f6] focus:ring-[#3b82f6] focus:ring-offset-0"
                />
                <span className="text-zinc-400">Mark report as Confidential in footer</span>
              </label>
            </div>
          </div>
          {exportPdfError && (
            <p className="mt-2 text-sm text-red-300">{exportPdfError}</p>
          )}
          {(reportError || previewError) && (
            <div className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              {reportError && (
                <p><strong>Report:</strong> {reportError.statusCode ? `HTTP ${reportError.statusCode} — ` : ""}{reportError.message}{reportError.reportId ? ` (Report ID: ${reportError.reportId})` : ""}</p>
              )}
              {previewError && (
                <p><strong>Preview:</strong> {previewError.statusCode ? `HTTP ${previewError.statusCode} — ` : ""}{previewError.message}{previewError.reportId ? ` (Report ID: ${previewError.reportId})` : ""}</p>
              )}
            </div>
          )}
        </section>

            {resultErrors.length > 0 && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                <h3 className="text-sm font-medium text-red-300 mb-2">
                  Errors by scenario
                </h3>
                <ul className="text-sm text-red-200 space-y-1">
                  {resultErrors.map(({ name, error }) => (
                    <li key={name}>
                      <strong>{name}:</strong> {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {comparisonRows.length > 0 && (
              <>
                <ComparisonTable
                  rows={comparisonRows}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                <Charts data={chartData} />
              </>
            )}
              </ResultsActionsCard>
          </div>
        </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
