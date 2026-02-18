"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { ScenarioList } from "@/components/ScenarioList";
import { ScenarioForm, defaultScenarioInput } from "@/components/ScenarioForm";
import { Charts, type ChartRow } from "@/components/Charts";
import { getApiUrl, getBaseUrl, fetchApi, fetchApiProxy, getAuthHeaders, CONNECTION_MESSAGE, getDisplayErrorMessage } from "@/lib/api";
import { ExtractUpload } from "@/components/ExtractUpload";
import { FeatureTiles } from "@/components/FeatureTiles";

const showDiagnostics =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_SHOW_DIAGNOSTICS === "true" &&
  process.env.NODE_ENV !== "production";

const Diagnostics = showDiagnostics
  ? dynamic(
      () => import("@/components/Diagnostics").then((m) => ({ default: m.Diagnostics })),
      { ssr: false }
    )
  : () => null;
import { UploadExtractCard } from "@/components/UploadExtractCard";
import { ResultsActionsCard } from "@/components/ResultsActionsCard";
import { Footer } from "@/components/Footer";
import type {
  ScenarioWithId,
  CashflowResult,
  NormalizerResponse,
  GenerateScenariosRequest,
  GenerateScenariosResponse,
  ScenarioInput,
  BrandConfig,
  BackendCanonicalLease,
} from "@/lib/types";
import { scenarioToCanonical, runMonthlyEngine } from "@/lib/lease-engine";
import { buildBrokerWorkbook, buildBrokerWorkbookFromCanonicalResponses, buildWorkbookLegacy } from "@/lib/exportModel";
import { SummaryMatrix } from "@/components/SummaryMatrix";
import {
  backendCanonicalToScenarioInput,
  scenarioInputToBackendCanonical,
  canonicalResponseToEngineResult,
  getPremisesDisplayName,
  normalizeLeaseType,
} from "@/lib/canonical-api";
import { NormalizeReviewCard } from "@/components/NormalizeReviewCard";
import type { CanonicalComputeResponse } from "@/lib/types";
const PENDING_SCENARIO_KEY = "lease_deck_pending_scenario";
const BRAND_ID_STORAGE_KEY = "lease_deck_brand_id";
const SCENARIOS_STATE_KEY = "lease_deck_scenarios_state";

type ReportErrorState = { statusCode: number; message: string; reportId?: string } | null;

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** POST /compute-canonical with request id, lease_type normalization, and lifecycle logs. */
async function fetchComputeCanonical(
  scenarioId: string,
  canonical: BackendCanonicalLease,
  init?: RequestInit
): Promise<Response> {
  const url = getApiUrl("/compute-canonical");
  console.log("[compute] outgoing canonical.lease_type=%s url=%s", (canonical as { lease_type?: string })?.lease_type, url);
  const payload = {
    ...canonical,
    lease_type: normalizeLeaseType(canonical?.lease_type),
  };
  const rid = crypto.randomUUID();
  const body = JSON.stringify(payload);
  const leaseTypeSent = (payload as { lease_type?: string }).lease_type;
  console.log("[compute] lease_type being sent (after normalizeLeaseType):", leaseTypeSent);
  console.log("[compute] fetchComputeCanonical", { url, lease_type: leaseTypeSent, rid });
  console.log("[compute] POST", { url, lease_type: leaseTypeSent, rid });
  console.log("[compute] start", { rid, url, scenario_id: scenarioId });
  console.log("[compute] body keys", { rid, keys: Object.keys(payload), scenario_id: scenarioId });
  console.log("[compute] about to POST", url, (canonical as { lease_type?: string })?.lease_type);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...getAuthHeaders(), "x-request-id": rid },
      body,
      ...(init ?? {}),
    });
    const responseText = await res.clone().text();
    const first200 = responseText.slice(0, 200);
    console.log("[compute] after POST status=%s responsePreview=%s", res.status, first200);
    console.log("[compute] RESP", { status: res.status, text: first200 });
    console.log("[compute] response", { rid, status: res.status });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[compute] error", { rid, msg });
    throw e;
  }
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
  const [renewalRelocateExpanded, setRenewalRelocateExpanded] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtractWarnings, setLastExtractWarnings] = useState<string[] | null>(null);
  const [pendingNormalize, setPendingNormalize] = useState<NormalizerResponse | null>(null);
  const [pendingNormalizeQueue, setPendingNormalizeQueue] = useState<NormalizerResponse[]>([]);
  const [brands, setBrands] = useState<BrandConfig[]>([]);
  const [brandId, setBrandId] = useState<string>("default");
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
  const [globalDiscountRate, setGlobalDiscountRate] = useState(0.08);
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [exportExcelError, setExportExcelError] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [includedInSummary, setIncludedInSummary] = useState<Record<string, boolean>>({});
  const [canonicalComputeCache, setCanonicalComputeCache] = useState<Record<string, CanonicalComputeResponse>>({});
  const isProduction = typeof process !== "undefined" && process.env.NODE_ENV === "production";

  const selectedScenario = scenarios.find((s) => s.id === selectedId) ?? null;

  const [hasRestored, setHasRestored] = useState(false);
  useEffect(() => {
    if (hasRestored || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(SCENARIOS_STATE_KEY);
      if (!raw) {
        setHasRestored(true);
        return;
      }
      const data = JSON.parse(raw) as { scenarios?: ScenarioWithId[]; baselineId?: string | null; includedInSummary?: Record<string, boolean> };
      if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        setScenarios(data.scenarios);
        if (data.scenarios[0]) setSelectedId(data.scenarios[0].id);
      }
      if (data.baselineId != null) setBaselineId(data.baselineId);
      if (data.includedInSummary && typeof data.includedInSummary === "object") setIncludedInSummary(data.includedInSummary);
      setHasRestored(true);
    } catch {
      setHasRestored(true);
    }
  }, [hasRestored]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasRestored) return;
    const included: Record<string, boolean> = {};
    scenarios.forEach((s) => {
      included[s.id] = includedInSummary[s.id] !== false;
    });
    try {
      localStorage.setItem(
        SCENARIOS_STATE_KEY,
        JSON.stringify({ scenarios, baselineId, includedInSummary: included })
      );
    } catch {
      // ignore
    }
  }, [scenarios, baselineId, includedInSummary, hasRestored]);

  useEffect(() => {
    if (typeof window === "undefined" || !isProduction || scenarios.length === 0) return;
    const missing = scenarios.filter((s) => !canonicalComputeCache[s.id]);
    if (missing.length === 0) return;
    missing.forEach((s) => {
      const canonical = scenarioInputToBackendCanonical(s, s.id, s.name);
      fetchComputeCanonical(s.id, canonical)
        .then((res) => {
          if (!res.ok) return;
          return res.json() as Promise<CanonicalComputeResponse>;
        })
        .then((data) => {
          if (data) setCanonicalComputeCache((prev) => ({ ...prev, [s.id]: data }));
        })
        .catch(() => {});
    });
  }, [scenarios, isProduction, canonicalComputeCache]);

  useEffect(() => {
    fetchApi("/brands", { method: "GET" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: BrandConfig[]) => setBrands(Array.isArray(data) ? data : []))
      .catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const s = localStorage.getItem(BRAND_ID_STORAGE_KEY);
      if (s) setBrandId(s);
    } catch {
      // ignore localStorage failures
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && brandId) {
      localStorage.setItem(BRAND_ID_STORAGE_KEY, brandId);
    }
  }, [brandId]);

  const runComputeForScenario = useCallback(
    async (scenario: ScenarioWithId) => {
      const canonical = scenarioInputToBackendCanonical(scenario, scenario.id, scenario.name);
      try {
        const res = await fetchComputeCanonical(scenario.id, canonical);
        if (!res.ok) return;
        const data = (await res.json()) as CanonicalComputeResponse;
        setCanonicalComputeCache((prev) => ({ ...prev, [scenario.id]: data }));
        setResults((prev) => ({
          ...prev,
          [scenario.id]: {
            term_months: data.metrics.term_months,
            rent_nominal: data.metrics.base_rent_total,
            opex_nominal: data.metrics.opex_total,
            total_cost_nominal: data.metrics.total_obligation_nominal,
            npv_cost: data.metrics.npv_cost,
            avg_cost_year: data.metrics.total_obligation_nominal / (data.metrics.term_months / 12 || 1),
            avg_cost_psf_year: data.metrics.avg_all_in_cost_psf_year,
          },
        }));
      } catch {
        // log already in fetchComputeCanonical
      }
    },
    []
  );

  const addScenarioFromCanonical = useCallback(
    (canonical: BackendCanonicalLease, onAdded?: (s: ScenarioWithId) => void) => {
      const scenarioInput = backendCanonicalToScenarioInput(canonical);
      const scenarioWithId: ScenarioWithId = { id: nextId(), ...scenarioInput };
      setScenarios((prev) => [...prev, scenarioWithId]);
      setSelectedId(scenarioWithId.id);
      setResults((prev) => {
        const next = { ...prev };
        delete next[scenarioWithId.id];
        return next;
      });
      setPendingNormalize(null);
      setExtractError(null);
      onAdded?.(scenarioWithId);
    },
    []
  );

  const handleNormalizeSuccess = useCallback(
    (data: NormalizerResponse) => {
      const hasCanonical = !!data?.canonical_lease;
      console.log("[compute] about to call", { hasCanonical });
      setLastExtractWarnings(data.warnings?.length ? data.warnings : null);
      setExtractError(null);
      const needsReview = data.confidence_score < 0.85 || (data.missing_fields?.length ?? 0) > 0;
      if (needsReview) {
        if (!pendingNormalize) {
          setPendingNormalize(data);
        } else {
          setPendingNormalizeQueue((prev) => [...prev, data]);
        }
        return;
      }
      setPendingNormalize(null);

      if (!data.canonical_lease) {
        console.log("[compute] skip: no canonical_lease");
        return;
      }

      const canonical = data.canonical_lease;
      const scenarioInput = backendCanonicalToScenarioInput(canonical);
      const scenarioWithId: ScenarioWithId = { id: nextId(), ...scenarioInput };
      setScenarios((prev) => [...prev, scenarioWithId]);
      setSelectedId(scenarioWithId.id);
      setResults((prev) => {
        const next = { ...prev };
        delete next[scenarioWithId.id];
        return next;
      });
      setPendingNormalize(null);
      setExtractError(null);

      const computeUrl = getApiUrl("/compute-canonical");
      const outgoingLeaseType = (canonical as { lease_type?: string })?.lease_type;
      console.log("[compute] outgoing canonical.lease_type=%s url=%s", outgoingLeaseType, computeUrl);
      fetchComputeCanonical(scenarioWithId.id, canonical)
        .then((res) => {
          console.log("[compute] response status", res.status);
          if (!res.ok) return null;
          return res.json() as Promise<CanonicalComputeResponse>;
        })
        .then((computeData) => {
          if (computeData) {
            setCanonicalComputeCache((prev) => ({ ...prev, [scenarioWithId.id]: computeData }));
            setResults((prev) => ({
              ...prev,
              [scenarioWithId.id]: {
                term_months: computeData.metrics.term_months,
                rent_nominal: computeData.metrics.base_rent_total,
                opex_nominal: computeData.metrics.opex_total,
                total_cost_nominal: computeData.metrics.total_obligation_nominal,
                npv_cost: computeData.metrics.npv_cost,
                avg_cost_year: computeData.metrics.total_obligation_nominal / (computeData.metrics.term_months / 12 || 1),
                avg_cost_psf_year: computeData.metrics.avg_all_in_cost_psf_year,
              },
            }));
          }
        })
        .catch((e) => console.error("[compute] failed", e));
    },
    [pendingNormalize]
  );

  const handleNormalizeConfirm = useCallback(
    (canonical: BackendCanonicalLease) => {
      addScenarioFromCanonical(canonical, (newScenario) => {
        console.log("[compute] about to run (confirm)", { scenarioId: newScenario.id, lease_type: (canonical as { lease_type?: string })?.lease_type ?? "NNN" });
        runComputeForScenario(newScenario);
      });
      setLastExtractWarnings(null);
      setPendingNormalize(null);
    },
    [addScenarioFromCanonical, runComputeForScenario]
  );

  const handleExtractError = useCallback((message: string) => {
    setExtractError(message);
    setLastExtractWarnings(null);
    if (!pendingNormalize && pendingNormalizeQueue.length > 0) {
      const [next, ...rest] = pendingNormalizeQueue;
      setPendingNormalize(next ?? null);
      setPendingNormalizeQueue(rest);
    }
  }, [pendingNormalize, pendingNormalizeQueue]);

  const handleNormalizeCancel = useCallback(() => {
    setPendingNormalize(null);
  }, []);

  useEffect(() => {
    if (pendingNormalize || pendingNormalizeQueue.length === 0) return;
    const [next, ...rest] = pendingNormalizeQueue;
    setPendingNormalize(next);
    setPendingNormalizeQueue(rest);
  }, [pendingNormalize, pendingNormalizeQueue]);

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
      discount_rate_annual: globalDiscountRate,
    };
    setScenarios((prev) => [...prev, newScenario]);
    setSelectedId(newScenario.id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[newScenario.id];
      return next;
    });
  }, [globalDiscountRate]);

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

  const acceptScenarioChanges = useCallback(() => {
    setSelectedId(null);
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
    // Invalidate stale compute outputs so summaries/charts reflect latest edits.
    setResults((prev) => {
      if (!(updated.id in prev)) return prev;
      const next = { ...prev };
      delete next[updated.id];
      return next;
    });
    setCanonicalComputeCache((prev) => {
      if (!(updated.id in prev)) return prev;
      const next = { ...prev };
      delete next[updated.id];
      return next;
    });
  }, []);

  const renameScenario = useCallback((id: string, newName: string) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName.trim() || s.name } : s))
    );
  }, []);

  const moveScenario = useCallback((id: string, direction: "up" | "down") => {
    setScenarios((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const j = direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const toggleIncludeInSummary = useCallback((id: string) => {
    setIncludedInSummary((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  }, []);

  const setLockBaseline = useCallback((id: string) => {
    setBaselineId((prev) => (prev === id ? null : id));
  }, []);

  const runAnalysis = useCallback(async () => {
    if (scenarios.length === 0) return;
    setLoading(true);
    setResults({});

    const headers = getAuthHeaders();

    if (isProduction) {
      const canonicalPayloads = scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        canonical: scenarioInputToBackendCanonical(s, s.id, s.name),
      }));
      const settled = await Promise.allSettled(
        canonicalPayloads.map(async ({ id, name, canonical }) => {
          const res = await fetchComputeCanonical(id, canonical);
          if (!res.ok) throw new Error("Compute failed");
          const data: CanonicalComputeResponse = await res.json();
          return { id, name, data };
        })
      );
      const nextCache: Record<string, CanonicalComputeResponse> = {};
      const nextResults: Record<string, CashflowResult | { error: string }> = {};
      settled.forEach((outcome, i) => {
        const { id, name } = canonicalPayloads[i];
        if (outcome.status === "fulfilled") {
          nextCache[id] = outcome.value.data;
          nextResults[id] = {
            term_months: outcome.value.data.metrics.term_months,
            rent_nominal: outcome.value.data.metrics.base_rent_total,
            opex_nominal: outcome.value.data.metrics.opex_total,
            total_cost_nominal: outcome.value.data.metrics.total_obligation_nominal,
            npv_cost: outcome.value.data.metrics.npv_cost,
            avg_cost_year: outcome.value.data.metrics.total_obligation_nominal / (outcome.value.data.metrics.term_months / 12 || 1),
            avg_cost_psf_year: outcome.value.data.metrics.avg_all_in_cost_psf_year,
          };
        } else {
          nextResults[id] = { error: getDisplayErrorMessage(outcome.reason) };
        }
      });
      setCanonicalComputeCache(nextCache);
      setResults(nextResults);
    } else {
      const payloads = scenarios.map((s) => ({ id: s.id, payload: scenarioToPayload(s) }));
      const settled = await Promise.allSettled(
        payloads.map(async ({ id, payload }) => {
          const res = await fetchApi("/compute", {
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
            error: outcome.reason?.message === CONNECTION_MESSAGE ? CONNECTION_MESSAGE : "Request failed",
          };
        }
      });
      setResults(nextResults);
    }
    setLoading(false);
  }, [scenarios, isProduction]);

  const buildReportMeta = useCallback(() => ({
    prepared_for: reportMeta.prepared_for || undefined,
    prepared_by: reportMeta.prepared_by || undefined,
    proposal_name: reportMeta.proposal_name || undefined,
    property_name: reportMeta.property_name || undefined,
    report_date: new Date().toISOString().slice(0, 10),
    confidential: reportMeta.confidential,
  }), [reportMeta]);

  const downloadBlob = useCallback((blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, []);

  const getScenarioResultForExport = useCallback((scenario: ScenarioWithId): CashflowResult => {
    const existing = results[scenario.id];
    if (existing && "term_months" in existing) return existing;

    const computed = runMonthlyEngine(scenarioToCanonical(scenario), globalDiscountRate);
    const rentNominal = computed.monthly.reduce((sum, row) => sum + row.baseRent, 0);
    const opexNominal = computed.monthly.reduce((sum, row) => sum + row.opex, 0);

    const safe = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    return {
      term_months: Math.max(0, Math.round(safe(computed.termMonths, 0))),
      rent_nominal: safe(rentNominal, 0),
      opex_nominal: safe(opexNominal, 0),
      total_cost_nominal: safe(computed.metrics.totalObligation, 0),
      npv_cost: safe(computed.metrics.npvAtDiscount, 0),
      avg_cost_year: safe(computed.metrics.avgAllInCostPerYear, 0),
      avg_cost_psf_year: safe(computed.metrics.avgCostPsfYr, 0),
    };
  }, [results, globalDiscountRate]);

  const exportPdfDeck = useCallback(async () => {
    if (scenarios.length === 0) {
      setExportPdfError("Add at least one scenario.");
      return;
    }
    setExportPdfLoading(true);
    setExportPdfError(null);
    try {
      const scenariosForDeck = scenarios.map((s) => ({
        scenario: scenarioToPayload(s),
        result: getScenarioResultForExport(s),
      }));
      const headers = getAuthHeaders();
      try {
        const res = await fetchApiProxy("/reports", {
          method: "POST",
          headers,
          body: JSON.stringify({
            scenarios: scenariosForDeck,
            branding: {},
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data: { report_id: string } = await res.json();
        const pdfRes = await fetchApiProxy(`/reports/${data.report_id}/pdf`, { method: "GET" });
        if (!pdfRes.ok) {
          const body = await pdfRes.json().catch(() => null);
          const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : `HTTP ${pdfRes.status}`;
          throw new Error(detail);
        }
        const blob = await pdfRes.blob();
        downloadBlob(blob, "lease-deck.pdf");
        return;
      } catch (deckErr) {
        const msg = deckErr instanceof Error ? deckErr.message : String(deckErr);
        console.error("[exportPdfDeck] deck route failed:", msg.slice(0, 600));
      }

      // Last-resort fallback only when there is a single scenario.
      if (scenarios.length === 1) {
        const fallbackScenario = selectedScenario ?? scenarios[0] ?? null;
        if (!fallbackScenario) throw new Error("No scenario available for PDF fallback.");
        try {
          const direct = await fetchApiProxy("/report", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              brand_id: brandId,
              scenario: scenarioToPayload(fallbackScenario),
              meta: buildReportMeta(),
            }),
          });
          if (direct.ok) {
            const blob = await direct.blob();
            downloadBlob(blob, "lease-financial-analysis.pdf");
            setExportPdfError("Deck routes failed; downloaded single-scenario PDF fallback.");
            return;
          }
        } catch (directErr) {
          const msg = directErr instanceof Error ? directErr.message : String(directErr);
          console.error("[exportPdfDeck] single-scenario /report fallback failed:", msg.slice(0, 600));
        }
      }

      throw new Error("All PDF export routes failed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[exportPdfDeck] fatal export error:", msg.slice(0, 600));
      setExportPdfError("PDF export failed on backend. Please retry after backend redeploy is complete.");
    } finally {
      setExportPdfLoading(false);
    }
  }, [scenarios, selectedScenario, brandId, buildReportMeta, getScenarioResultForExport, downloadBlob]);

  const generateReport = useCallback(async () => {
    if (!selectedScenario) {
      setReportError({ statusCode: 0, message: "Select a scenario first." });
      return;
    }
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetchApi("/report", {
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
        if (res.status === 503) {
          const previewRes = await fetchApi("/report/preview", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              brand_id: brandId,
              scenario: scenarioToPayload(selectedScenario),
              meta: buildReportMeta(),
            }),
          });
          if (previewRes.ok) {
            const html = await previewRes.text();
            const w = window.open("", "_blank", "noopener,noreferrer");
            if (w) {
              w.document.write(html);
              w.document.close();
            }
            setReportError({ statusCode: 503, message: "PDF service unavailable, opened HTML preview instead.", reportId });
            return;
          }
        }
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
      setReportError({ statusCode: 0, message: getDisplayErrorMessage(err) });
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
      const res = await fetchApi("/report/preview", {
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
      setPreviewError({ statusCode: 0, message: getDisplayErrorMessage(err) });
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
      const res = await fetchApi("/generate_scenarios", {
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
      setGenerateError(getDisplayErrorMessage(err));
    } finally {
      setGenerateLoading(false);
    }
  }, []);

  const exportExcelDeck = useCallback(async () => {
    if (scenarios.length === 0) {
      setExportExcelError("Add at least one scenario.");
      return;
    }
    setExportExcelLoading(true);
    setExportExcelError(null);
    try {
      const canonical = scenarios.map(scenarioToCanonical);
      let buffer: ArrayBuffer | null = null;
      let usedFallback = false;
      try {
        if (isProduction && scenarios.every((s) => canonicalComputeCache[s.id])) {
          const items = scenarios.map((s) => {
            const res = canonicalComputeCache[s.id]!;
            const scenarioName = getPremisesDisplayName({
              building_name: res.metrics.building_name,
              suite: res.metrics.suite,
              premises_name: res.metrics.premises_name,
              scenario_name: s.name,
            });
            return { response: res, scenarioName };
          });
          buffer = await buildBrokerWorkbookFromCanonicalResponses(items);
        } else {
          buffer = await buildBrokerWorkbook(canonical, globalDiscountRate);
        }
      } catch (primaryErr) {
        console.error("[exportExcelDeck] broker workbook failed; falling back to legacy workbook", primaryErr);
        buffer = await buildWorkbookLegacy(canonical, globalDiscountRate);
        usedFallback = true;
      }
      downloadBlob(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "lease-comparison.xlsx"
      );
      if (usedFallback) {
        setExportExcelError("Downloaded Excel using fallback format because the primary format failed.");
      }
    } catch (err) {
      console.error("[exportExcelDeck] fatal export error", err);
      setExportExcelError(getDisplayErrorMessage(err));
    } finally {
      setExportExcelLoading(false);
    }
  }, [scenarios, globalDiscountRate, isProduction, canonicalComputeCache, downloadBlob]);

  const engineResults = useMemo(() => {
    const included = scenarios.filter((s) => includedInSummary[s.id] !== false);
    if (isProduction) {
      return included.map((s) => {
        const cached = canonicalComputeCache[s.id];
        if (cached) {
          const displayName = getPremisesDisplayName({
            building_name: cached.metrics.building_name,
            suite: cached.metrics.suite,
            premises_name: cached.metrics.premises_name,
            scenario_name: s.name,
          });
          return canonicalResponseToEngineResult(cached, s.id, displayName);
        }
        // Fallback to local engine while canonical compute is loading/recomputing.
        return runMonthlyEngine(scenarioToCanonical(s), globalDiscountRate);
      });
    }
    return included.map((s) => runMonthlyEngine(scenarioToCanonical(s), globalDiscountRate));
  }, [scenarios, globalDiscountRate, includedInSummary, isProduction, canonicalComputeCache]);

  const chartData: ChartRow[] = engineResults
    .map((r) => ({
      name: r.scenarioName,
      avg_cost_psf_year: Number(r.metrics.avgCostPsfYr),
      npv_cost: Number(r.metrics.npvAtDiscount),
      avg_cost_year: Number(r.metrics.avgAllInCostPerYear),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.avg_cost_psf_year) &&
        Number.isFinite(row.npv_cost) &&
        Number.isFinite(row.avg_cost_year)
    );

  const resultErrors = scenarios
    .map((s) => {
      const r = results[s.id];
      if (r && "error" in r) return { name: s.name, error: r.error };
      return null;
    })
    .filter((x): x is { name: string; error: string } => x !== null);

  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white flex flex-col justify-center items-center text-center px-6 pt-24">
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-tight">
          The Commercial Real Estate Model
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

      <main className="relative z-10 max-w-[96rem] mx-auto px-6 py-12 md:py-16">
        <section id="extract" className="scroll-mt-24">
        <div className="grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] xl:grid-cols-[0.8fr_1.2fr] gap-8 lg:gap-10">
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
                <h2 className="text-lg font-semibold text-white mb-4">
                  Upload & extract
                </h2>
                <p className="text-sm text-zinc-400 mb-4">
                  Upload a PDF or DOCX lease. We extract text (OCR runs automatically for scanned PDFs), then normalize to a lease option. If confidence is low or fields are missing, you’ll review and confirm before adding.
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
                <ExtractUpload
                  showAdvancedOptions={showDiagnostics}
                  onSuccess={handleNormalizeSuccess}
                  onError={handleExtractError}
                />
                {pendingNormalize && (
                  <div className="mt-4">
                    <NormalizeReviewCard
                      data={pendingNormalize}
                      onConfirm={handleNormalizeConfirm}
                      onCancel={handleNormalizeCancel}
                    />
                  </div>
                )}
                {extractError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                    {extractError}
                  </div>
                )}
                {showDiagnostics && (
                  <div className="mt-4">
                    <Diagnostics />
                  </div>
                )}
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
          onRename={renameScenario}
          onMove={moveScenario}
          onToggleIncludeInSummary={toggleIncludeInSummary}
          onLockBaseline={setLockBaseline}
          baselineId={baselineId}
          includedInSummary={includedInSummary}
        />

        <ScenarioForm
          scenario={selectedScenario}
          onUpdate={updateScenario}
          onAddScenario={addScenario}
          onDuplicateScenario={duplicateScenario}
          onDeleteScenario={deleteScenario}
          onAcceptChanges={acceptScenarioChanges}
        />

        <section className="pt-6 border-t border-white/10">
          <p className="text-xs uppercase tracking-widest text-zinc-500 font-medium mb-2">Exports</p>
          <h2 className="text-lg font-semibold text-white mb-2">Compute & report</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Export Excel or PDF directly from your current scenarios. Analysis refresh is optional.
          </p>
          <label className="flex items-center gap-2 text-sm text-zinc-400 mb-3">
            <span>Discount rate (default 8%):</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.25}
              value={globalDiscountRate * 100}
              onChange={(e) => setGlobalDiscountRate(Number(e.target.value) / 100)}
              className="w-20 rounded-lg border border-white/20 bg-white/5 text-white px-2 py-1 text-sm"
            />
            <span>%</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={exportExcelDeck}
              disabled={exportExcelLoading || scenarios.length === 0}
              className="rounded-full bg-emerald-600/90 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-600 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {exportExcelLoading ? "Exporting…" : "Export Excel"}
            </button>
            <button
              type="button"
              onClick={exportPdfDeck}
              disabled={exportPdfLoading || scenarios.length === 0}
              className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-all disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
            >
              {exportPdfLoading ? "Exporting…" : "Export PDF deck"}
            </button>
          </div>
          <details className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <summary className="cursor-pointer text-sm text-zinc-300">Advanced report actions</summary>
            <div className="mt-3 flex flex-wrap gap-3">
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
          </details>
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
          {(exportPdfError || exportExcelError) && (
            <p className="mt-2 text-sm text-red-300">{exportPdfError || exportExcelError}</p>
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

            {engineResults.length > 0 && (
              <>
                <SummaryMatrix results={engineResults} />
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
