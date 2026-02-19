"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { ScenarioList } from "@/components/ScenarioList";
import { ScenarioForm, defaultScenarioInput } from "@/components/ScenarioForm";
import { Charts, type ChartRow } from "@/components/Charts";
import { getApiUrl, fetchApiProxy, getAuthHeaders, getDisplayErrorMessage } from "@/lib/api";
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
  ScenarioInput,
  BackendCanonicalLease,
  ExtractionSummary,
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
const NOISY_WARNING_PATTERNS = [
  /automatic extraction failed due to a backend processing issue/i,
  /automatic extraction failed\.\s*heuristic review template loaded/i,
  /ai extraction fallback was used for this upload/i,
  /rent_schedule was empty; added single step at \$0/i,
  /automatic extraction fallback was used for this upload/i,
  /expiration inferred from \d+-month lease term and commencement date/i,
];
const HARD_REVIEW_WARNING_PATTERNS = [
  /automatic extraction failed/i,
  /review template/i,
  /no text could be extracted/i,
  /could not process this file automatically/i,
  /could not confidently parse/i,
  /lease normalization failed/i,
];

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeExtractionWarnings(warnings?: string[] | null): string[] {
  const source = Array.isArray(warnings) ? warnings : [];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const msg = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!msg) continue;
    if (NOISY_WARNING_PATTERNS.some((p) => p.test(msg))) continue;
    const key = msg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(msg);
  }
  return deduped;
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
  const startMonthRaw = Math.max(0, Math.floor(Number((rest as { free_rent_start_month?: number }).free_rent_start_month ?? 0) || 0));
  const endMonthDerived = free_rent_months > 0 ? startMonthRaw + free_rent_months - 1 : startMonthRaw;
  const freeRentType: "base" | "gross" =
    (rest as { free_rent_abatement_type?: string }).free_rent_abatement_type === "gross" ? "gross" : "base";
  const payload: Omit<ScenarioWithId, "id"> = {
    ...rest,
    free_rent_months,
    free_rent_start_month: startMonthRaw,
    free_rent_end_month: Math.max(startMonthRaw, Math.floor(Number((rest as { free_rent_end_month?: number }).free_rent_end_month ?? endMonthDerived) || endMonthDerived)),
    free_rent_abatement_type: freeRentType,
  };
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
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtractWarnings, setLastExtractWarnings] = useState<string[] | null>(null);
  const [lastExtractionSummary, setLastExtractionSummary] = useState<ExtractionSummary | null>(null);
  const [pendingNormalizeQueue, setPendingNormalizeQueue] = useState<NormalizerResponse[]>([]);
  const [brandId, setBrandId] = useState<string>("default");
  const [globalDiscountRate, setGlobalDiscountRate] = useState(0.08);
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [exportExcelError, setExportExcelError] = useState<string | null>(null);
  const [includedInSummary, setIncludedInSummary] = useState<Record<string, boolean>>({});
  const [canonicalComputeCache, setCanonicalComputeCache] = useState<Record<string, CanonicalComputeResponse>>({});
  const isProduction = typeof process !== "undefined" && process.env.NODE_ENV === "production";
  const pendingNormalize = pendingNormalizeQueue[0] ?? null;

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
      const data = JSON.parse(raw) as { scenarios?: ScenarioWithId[]; includedInSummary?: Record<string, boolean> };
      if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        setScenarios(data.scenarios);
        if (data.scenarios[0]) setSelectedId(data.scenarios[0].id);
      }
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
        JSON.stringify({ scenarios, includedInSummary: included })
      );
    } catch {
      // ignore
    }
  }, [scenarios, includedInSummary, hasRestored]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>(".reveal-on-scroll"));
    if (!prefersReduced) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target.classList.add("is-visible");
          });
        },
        { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
      );
      revealTargets.forEach((el) => observer.observe(el));
      const onScroll = () => {
        const y = window.scrollY * 0.12;
        document.documentElement.style.setProperty("--hero-scroll-y", `${Math.max(-64, Math.min(64, y))}px`);
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        observer.disconnect();
        window.removeEventListener("scroll", onScroll);
      };
    }
    revealTargets.forEach((el) => el.classList.add("is-visible"));
    return undefined;
  }, []);

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
      setExtractError(null);
      onAdded?.(scenarioWithId);
    },
    []
  );

  const handleNormalizeSuccess = useCallback(
    (data: NormalizerResponse) => {
      const hasCanonical = !!data?.canonical_lease;
      console.log("[compute] about to call", { hasCanonical });
      const warnings = sanitizeExtractionWarnings(data.warnings);
      setLastExtractWarnings(warnings.length > 0 ? warnings : null);
      setLastExtractionSummary(data.extraction_summary ?? null);
      setExtractError(null);

      if (!data.canonical_lease) {
        console.log("[compute] skip: no canonical_lease");
        setExtractError("Extraction completed, but no lease payload was returned. Please retry the upload.");
        return;
      }

      const canonical = data.canonical_lease;
      const documentTypeDetected = (data.extraction_summary?.document_type_detected || "unknown").trim();
      const canonicalWithDocType: BackendCanonicalLease = {
        ...canonical,
        document_type_detected: documentTypeDetected || "unknown",
      };
      const criticalMissing = new Set(["rsf", "rent_schedule", "term_months", "commencement_date", "expiration_date"]);
      const hasCriticalMissing = (data.missing_fields ?? []).some((f) => criticalMissing.has(String(f)));
      const hasHardReviewWarning = warnings.some((w) =>
        HARD_REVIEW_WARNING_PATTERNS.some((p) => p.test(w))
      );
      const hasInvalidCoreValues =
        !canonicalWithDocType ||
        !Number.isFinite(Number(canonicalWithDocType.rsf)) ||
        Number(canonicalWithDocType.rsf) <= 0 ||
        !Number.isFinite(Number(canonicalWithDocType.term_months)) ||
        Number(canonicalWithDocType.term_months) <= 0 ||
        !Array.isArray(canonicalWithDocType.rent_schedule) ||
        canonicalWithDocType.rent_schedule.length === 0;
      const needsReview = hasCriticalMissing || hasHardReviewWarning || hasInvalidCoreValues;

      if (needsReview) {
        const queued: NormalizerResponse = {
          ...data,
          canonical_lease: canonicalWithDocType,
          warnings,
        };
        setPendingNormalizeQueue((prev) => [...prev, queued]);
        return;
      }

      addScenarioFromCanonical(canonicalWithDocType, (newScenario) => {
        console.log("[compute] about to run", {
          scenarioId: newScenario.id,
          lease_type: (canonicalWithDocType as { lease_type?: string })?.lease_type ?? "NNN",
          document_type_detected: (canonicalWithDocType as { document_type_detected?: string })?.document_type_detected ?? "unknown",
        });
        runComputeForScenario(newScenario);
      });
    },
    [addScenarioFromCanonical, runComputeForScenario]
  );

  const handleNormalizeConfirm = useCallback(
    (canonical: BackendCanonicalLease) => {
      const canonicalWithDocType: BackendCanonicalLease = {
        ...canonical,
        document_type_detected:
          ((canonical as { document_type_detected?: string })?.document_type_detected || lastExtractionSummary?.document_type_detected || "unknown")
            .toString()
            .trim() || "unknown",
      };
      addScenarioFromCanonical(canonicalWithDocType, (newScenario) => {
        console.log("[compute] about to run (confirm)", {
          scenarioId: newScenario.id,
          lease_type: (canonicalWithDocType as { lease_type?: string })?.lease_type ?? "NNN",
          document_type_detected: (canonicalWithDocType as { document_type_detected?: string })?.document_type_detected ?? "unknown",
        });
        runComputeForScenario(newScenario);
      });
      setLastExtractWarnings(null);
      setLastExtractionSummary(null);
      setPendingNormalizeQueue((prev) => prev.slice(1));
    },
    [addScenarioFromCanonical, runComputeForScenario, lastExtractionSummary]
  );

  const handleNormalizeCancel = useCallback(() => {
    setLastExtractionSummary(null);
    setPendingNormalizeQueue((prev) => prev.slice(1));
  }, []);

  const handleExtractError = useCallback((message: string) => {
    setExtractError(message || null);
    if (message) {
      setLastExtractWarnings(null);
      setLastExtractionSummary(null);
    }
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

  const reorderScenario = useCallback((fromId: string, toId: string) => {
    setScenarios((prev) => {
      const fromIndex = prev.findIndex((s) => s.id === fromId);
      const toIndex = prev.findIndex((s) => s.id === toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const toggleIncludeInSummary = useCallback((id: string) => {
    setIncludedInSummary((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  }, []);

  const buildReportMeta = useCallback(() => ({
    report_date: new Date().toISOString().slice(0, 10),
    confidential: true,
  }), []);

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
              floor: res.metrics.floor,
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
            floor: cached.metrics.floor,
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
      total_obligation: Number(r.metrics.totalObligation),
    }))
    .filter(
      (row) =>
        Number.isFinite(row.avg_cost_psf_year) &&
        Number.isFinite(row.npv_cost) &&
        Number.isFinite(row.avg_cost_year) &&
        Number.isFinite(row.total_obligation)
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
      <section className="relative z-10 section-shell pt-28 sm:pt-32 bg-tech-grid">
        <div className="app-container">
          <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] border border-white/25">
            <div className="p-6 sm:p-8 lg:p-12 border-b xl:border-b-0 xl:border-r border-white/25 reveal-on-scroll">
              <p className="heading-kicker mb-4">Platform</p>
              <h1 className="heading-display max-w-3xl">
                The Commercial Real Estate Model
              </h1>

              <p className="body-lead mt-6 max-w-xl">
                Transform any lease into a structured, branded financial analysis in minutes.
                Built for brokerages, investment firms, and enterprise real estate teams.
              </p>

              <div className="flex gap-3 sm:gap-4 mt-8 flex-wrap">
                <a
                  href="/example"
                  className="btn-premium btn-premium-primary w-full sm:w-auto px-8"
                >
                  View Example Report
                </a>

                <a
                  href="#extract"
                  className="btn-premium btn-premium-secondary w-full sm:w-auto px-8"
                >
                  Try It Live
                </a>
              </div>
            </div>
            <div className="p-4 sm:p-6 lg:p-8 bg-white/[0.01] reveal-on-scroll">
              <div className="border border-white/25 bg-black/65">
                <div className="grid grid-cols-12">
                  <div className="col-span-8 border-r border-b border-white/25 p-4 hero-parallax-layer" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.2)" }}>
                    <p className="heading-kicker mb-2">Scenarios</p>
                    <p className="text-4xl sm:text-5xl tracking-tight text-white leading-none">
                      {Math.max(1, scenarios.length)}
                    </p>
                  </div>
                  <div className="col-span-4 border-b border-white/25 p-4 hero-parallax-layer" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.12)" }}>
                    <p className="heading-kicker mb-2">Status</p>
                    <p className="text-lg text-white/90 leading-tight">{(exportExcelLoading || exportPdfLoading) ? "Running" : "Ready"}</p>
                  </div>
                  <div className="col-span-5 border-r border-b border-white/25 p-4 hero-parallax-layer" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.08)" }}>
                    <p className="heading-kicker mb-2">Brand</p>
                    <p className="text-base text-white/90 leading-tight">{brandId || "default"}</p>
                  </div>
                  <div className="col-span-7 border-b border-white/25 p-4 hero-parallax-layer" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.15)" }}>
                    <p className="heading-kicker mb-2">Discount rate</p>
                    <p className="text-3xl tracking-tight text-white leading-none">{(globalDiscountRate * 100).toFixed(2)}%</p>
                  </div>
                  <div className="col-span-12 p-4 hero-parallax-layer" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.1)" }}>
                    <p className="heading-kicker mb-2">Document pipeline</p>
                    <div className="grid grid-cols-3 gap-2 text-[11px] uppercase tracking-[0.12em] text-white/75">
                      <span className="border border-white/20 px-2 py-1">Upload</span>
                      <span className="border border-white/20 px-2 py-1">Extract</span>
                      <span className="border border-white/20 px-2 py-1">Compare</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <FeatureTiles />

      <main className="relative z-10 app-container pb-14 md:pb-20">
        <section id="extract" className="scroll-mt-24">
        <div className="grid grid-cols-1 xl:grid-cols-[0.86fr_1.14fr] gap-6 lg:gap-8 2xl:gap-10 bg-tech-grid border border-white/15 p-3 sm:p-4">
          {/* Left column: upload & extract */}
          <div className="space-y-5 sm:space-y-6">
            <div id="upload-section" className="reveal-on-scroll">
              <UploadExtractCard>
                <p className="heading-kicker mb-2">Extract from document</p>
                <h2 className="heading-section mb-3">
                  Upload & extract
                </h2>
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
                    {pendingNormalizeQueue.length > 1 && (
                      <p className="mt-2 text-xs text-slate-400">
                        {pendingNormalizeQueue.length - 1} more extracted file{pendingNormalizeQueue.length - 1 === 1 ? "" : "s"} waiting for review.
                      </p>
                    )}
                  </div>
                )}
                {extractError && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                    {extractError}
                  </div>
                )}
                {showDiagnostics && (
                  <div className="mt-4">
                    <Diagnostics />
                  </div>
                )}
                {lastExtractWarnings && lastExtractWarnings.length > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm">
                    <p className="font-medium text-amber-200 mb-1">Warnings from extraction</p>
                    <ul className="list-disc list-inside text-amber-100/90 space-y-0.5">
                      {lastExtractWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {lastExtractionSummary && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-900/45 border border-slate-300/20 text-sm">
                    <p className="font-medium text-slate-100 mb-2">Extraction summary</p>
                    <div className="space-y-1 text-slate-300 text-xs">
                      <p>
                        <span className="text-slate-400">Document type detected:</span>{" "}
                        {lastExtractionSummary.document_type_detected || "unknown"}
                      </p>
                      {lastExtractionSummary.key_terms_found.length > 0 && (
                        <div>
                          <p className="text-slate-400">Key terms found</p>
                          <ul className="list-disc list-inside text-slate-300">
                            {lastExtractionSummary.key_terms_found.map((item, i) => (
                              <li key={`${item}-${i}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {lastExtractionSummary.key_terms_missing.length > 0 && (
                        <div>
                          <p className="text-slate-400">Key terms missing</p>
                          <ul className="list-disc list-inside text-slate-300">
                            {lastExtractionSummary.key_terms_missing.map((item, i) => (
                              <li key={`${item}-${i}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {lastExtractionSummary.sections_searched.length > 0 && (
                        <p>
                          <span className="text-slate-400">Sections searched:</span>{" "}
                          {lastExtractionSummary.sections_searched.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </UploadExtractCard>
            </div>
          </div>

          {/* Right column: scenarios + form + actions */}
          <div className="space-y-5 sm:space-y-6">
            <ResultsActionsCard>
        <ScenarioList
          scenarios={scenarios}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDuplicate={duplicateFromList}
          onDelete={deleteScenario}
          onRename={renameScenario}
          onReorder={reorderScenario}
          onToggleIncludeInSummary={toggleIncludeInSummary}
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

        <section className="pt-7 border-t border-slate-300/20">
          <p className="heading-kicker mb-2">Exports</p>
          <h2 className="heading-section mb-2">Compute & report</h2>
          <p className="text-sm text-slate-300 mb-4">
            Export Excel or PDF directly from your current scenarios. Analysis refresh is optional.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300 mb-4">
            <span>Discount rate (default 8%):</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.25}
              value={globalDiscountRate * 100}
              onChange={(e) => setGlobalDiscountRate(Number(e.target.value) / 100)}
              className="input-premium w-24 !min-h-0 py-1.5"
            />
            <span>%</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={exportExcelDeck}
              disabled={exportExcelLoading || scenarios.length === 0}
              className="btn-premium btn-premium-success w-full sm:w-auto disabled:opacity-50"
            >
              {exportExcelLoading ? "Exporting…" : "Export Excel"}
            </button>
            <button
              type="button"
              onClick={exportPdfDeck}
              disabled={exportPdfLoading || scenarios.length === 0}
              className="btn-premium btn-premium-secondary w-full sm:w-auto disabled:opacity-50"
            >
              {exportPdfLoading ? "Exporting…" : "Export PDF deck"}
            </button>
          </div>
          {(exportPdfError || exportExcelError) && (
            <p className="mt-2 text-sm text-red-300">{exportPdfError || exportExcelError}</p>
          )}
        </section>

            {resultErrors.length > 0 && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4">
                <h3 className="text-sm font-medium text-red-200 mb-2">
                  Errors by scenario
                </h3>
                <ul className="text-sm text-red-100/90 space-y-1">
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
