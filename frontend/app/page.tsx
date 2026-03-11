"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ScenarioList } from "@/components/ScenarioList";
import { ScenarioForm, defaultScenarioInput } from "@/components/ScenarioForm";
import type { ChartRow } from "@/components/Charts";
import { getApiUrl, fetchApiProxy, getAuthHeaders, getDisplayErrorMessage } from "@/lib/api";
import { ExtractUpload } from "@/components/ExtractUpload";
import { FeatureTiles } from "@/components/FeatureTiles";
import {
  PlatformModuleTabs,
} from "@/components/platform/PlatformShell";
import {
  DEFAULT_PLATFORM_MODULE_ID,
  FINANCIAL_ANALYSES_TOOL_TABS,
  isFinancialAnalysesToolId,
  resolveActivePlatformModule,
  type FinancialAnalysesToolId,
  type PlatformModuleId,
} from "@/lib/platform/module-registry";

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
import { ResultsActionsCard } from "@/components/ResultsActionsCard";
import { ClientLogoUploader } from "@/components/ClientLogoUploader";
import type {
  ScenarioWithId,
  CashflowResult,
  NormalizerResponse,
  ReportMeta,
  ScenarioInput,
  BackendCanonicalLease,
  CustomChartExportConfig,
} from "@/lib/types";
import { scenarioToCanonical, runMonthlyEngine } from "@/lib/lease-engine";
import { buildBrokerWorkbook, buildBrokerWorkbookFromCanonicalResponses } from "@/lib/exportModel";
import { SummaryMatrix } from "@/components/SummaryMatrix";
import { AnalyticsWorkbench } from "@/components/AnalyticsWorkbench";
import { formatDateISO } from "@/lib/format";
import { computeEqualizedComparison, type EqualizedWindowInput } from "@/lib/equalized";
import {
  backendCanonicalToScenarioInput,
  scenarioInputToBackendCanonical,
  canonicalResponseToEngineResult,
  getPremisesDisplayName,
  normalizeLeaseType,
} from "@/lib/canonical-api";
import {
  effectiveTiAllowancePsf,
  effectiveTiBudgetTotal,
  hasValidRsfForTi,
  normalizeTiSourceOfTruth,
  round0,
  syncTiFields,
} from "@/lib/ti";
import type { CanonicalComputeResponse } from "@/lib/types";
import type { SupabaseAuthSession } from "@/lib/supabase";
import {
  applyLeaseModelChoice,
  hasCommencementBeforeToday,
} from "@/lib/remaining-obligation";
import { harmonizeExtractedScenarios } from "@/lib/scenario-harmonization";
import {
  type UserBrandingResponse,
  fetchUserBranding,
} from "@/lib/user-settings";
import { SubleaseRecoveryAnalysis } from "@/components/sublease-recovery/SubleaseRecoveryAnalysis";
import { CompletedLeasesWorkspace } from "@/components/completed-leases/CompletedLeasesWorkspace";
import { SurveysWorkspace } from "@/components/surveys/SurveysWorkspace";
import { ObligationsWorkspace } from "@/components/obligations/ObligationsWorkspace";
import { buildPlatformExportFileName } from "@/lib/export-design";
import { downloadBlob as downloadBlobFile } from "@/lib/export-runtime";
import { buildFinancialAnalysesShareLink } from "@/lib/financial-analyses/share";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { makeClientScopedStorageKey } from "@/lib/workspace/storage";
import { ClientWorkspaceGate } from "@/components/workspace/ClientWorkspaceGate";
import { ClientDocumentCenter } from "@/components/workspace/ClientDocumentCenter";
import { ClientDocumentPicker } from "@/components/workspace/ClientDocumentPicker";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";
const PENDING_SCENARIO_KEY = "lease_deck_pending_scenario";
const BRAND_ID_STORAGE_KEY = "lease_deck_brand_id";
const SCENARIOS_STATE_KEY = "lease_deck_scenarios_state";
const REPORT_META_STATE_KEY = "lease_deck_report_meta_state";
const CRE_DEFAULT_BROKERAGE_NAME = "The CRE Model";
const CRE_DEFAULT_PREPARED_BY = "The CRE Model";
const CRE_DEFAULT_LOGO_PUBLIC_PATH = "/brand/logo.png";

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanMaybeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalVariantOptionRank(c: BackendCanonicalLease): number {
  const haystack = `${cleanMaybeString(c.scenario_name)} ${cleanMaybeString(c.premises_name)}`.toLowerCase();
  if (/\boption\s*(?:a|1|one)\b/i.test(haystack)) return 0;
  if (/\boption\s*(?:b|2|two)\b/i.test(haystack)) return 1;
  return 9;
}

function canonicalVariantKey(c: BackendCanonicalLease): string {
  const rentSig = (Array.isArray(c.rent_schedule) ? c.rent_schedule : [])
    .map((step) => {
      const start = Number(step.start_month ?? 0);
      const end = Number(step.end_month ?? start);
      const rate = Number(step.rent_psf_annual ?? 0);
      return `${start}-${end}-${rate.toFixed(4)}`;
    })
    .join("|");
  return [
    cleanMaybeString(c.commencement_date),
    cleanMaybeString(c.expiration_date),
    String(Number(c.term_months ?? 0)),
    String(Number(c.free_rent_months ?? 0)),
    String(Number(c.rsf ?? 0)),
    rentSig,
  ].join("::");
}

function collectCanonicalVariants(
  canonicalLease: BackendCanonicalLease,
  optionVariants?: BackendCanonicalLease[] | null
): BackendCanonicalLease[] {
  const parsedOptionVariants = (Array.isArray(optionVariants) ? optionVariants : []).filter(
    (variant): variant is BackendCanonicalLease => !!variant
  );
  // When backend provides explicit option variants, do not also add the base canonical lease
  // to avoid phantom duplicate options in the UI.
  const all = parsedOptionVariants.length >= 2
    ? parsedOptionVariants
    : [canonicalLease, ...parsedOptionVariants];
  const deduped = new Map<string, BackendCanonicalLease>();
  for (const variant of all) {
    const key = canonicalVariantKey(variant);
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, variant);
      continue;
    }
    const existing = deduped.get(key)!;
    if (canonicalVariantOptionRank(variant) < canonicalVariantOptionRank(existing)) {
      deduped.set(key, variant);
    }
  }
  return Array.from(deduped.values()).sort((left, right) => {
    const rankDiff = canonicalVariantOptionRank(left) - canonicalVariantOptionRank(right);
    if (rankDiff !== 0) return rankDiff;
    return canonicalVariantKey(left).localeCompare(canonicalVariantKey(right));
  });
}

function canonicalDisplayNameForAdd(
  canonical: BackendCanonicalLease,
  index: number,
  total: number
): string {
  const explicitName = cleanMaybeString(canonical.scenario_name);
  const explicitHasOption = /\boption\s*(?:a|b|1|2|one|two)\b/i.test(explicitName);
  if (explicitName && (total <= 1 || explicitHasOption)) return explicitName;
  if (total <= 1) return "";
  const base = explicitName || getPremisesDisplayName({
    building_name: canonical.building_name,
    suite: canonical.suite,
    floor: canonical.floor,
    premises_name: canonical.premises_name,
    scenario_name: canonical.scenario_name,
  });
  if (/\boption\s*(?:a|b|1|2|one|two)\b/i.test(base)) return base;
  const optionLabel = canonicalVariantOptionRank(canonical) === 0
    ? "Option A"
    : canonicalVariantOptionRank(canonical) === 1
      ? "Option B"
      : `Option ${index + 1}`;
  return `${base} - ${optionLabel}`.trim();
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .map((word) => {
      const clean = word.trim();
      if (!clean) return "";
      return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(" ");
}

function derivePreparedByFromSession(session: SupabaseAuthSession | null): string {
  const explicitName = cleanMaybeString(session?.user?.name);
  if (explicitName) return explicitName;
  const email = cleanMaybeString(session?.user?.email);
  if (!email) return "";
  const localPart = cleanMaybeString(email.split("@")[0] || "");
  if (!localPart) return "";
  const spaced = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return titleCaseWords(spaced);
}

function inferMarketFromAddress(address: string): string {
  const raw = String(address || "").trim();
  if (!raw) return "";
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  const city = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
  const statePart = parts[parts.length - 1] || "";
  const stateMatch = statePart.match(/\b([A-Z]{2}|[A-Za-z]{4,})\b/);
  const state = stateMatch ? stateMatch[1].trim() : "";
  if (!city) return "";
  return state ? `${city}, ${state}` : city;
}

function parseErrorPayloadText(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown; message?: unknown };
    let detail = "";
    if (typeof parsed.detail === "string") {
      detail = parsed.detail.trim();
    } else if (Array.isArray(parsed.detail)) {
      const parts = parsed.detail
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object" && "msg" in item) {
            const msg = (item as { msg?: unknown }).msg;
            return typeof msg === "string" ? msg.trim() : "";
          }
          return "";
        })
        .filter(Boolean);
      detail = parts.join("; ");
    }
    const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    return detail || error || message || text;
  } catch {
    return text;
  }
}

function extractDataUrlBase64(dataUrl: string | null | undefined): string | null {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  return match[1].replace(/\s+/g, "");
}

function getDataUrlMime(dataUrl: string | null | undefined): string | null {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;]+);base64,/i);
  return match ? match[1].toLowerCase() : null;
}

async function normalizeLogoDataUrlForExcel(dataUrl: string | null | undefined): Promise<string | null> {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    if (typeof window === "undefined") return null;
    try {
      const res = await fetch(raw, { credentials: "omit", cache: "no-store" });
      if (!res.ok) return null;
      const blob = await res.blob();
      const mime = (blob.type || "").toLowerCase();
      if (!mime.startsWith("image/")) return null;
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }
  if (!raw.startsWith("data:image/")) return null;
  const mime = getDataUrlMime(raw);
  if (!mime) return null;
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/jpg") return raw;
  if (mime !== "image/svg+xml") return null;

  if (typeof window === "undefined") return null;
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const maxWidth = 720;
        const maxHeight = 220;
        const widthRatio = maxWidth / Math.max(1, image.naturalWidth || image.width || 1);
        const heightRatio = maxHeight / Math.max(1, image.naturalHeight || image.height || 1);
        const scale = Math.min(1, widthRatio, heightRatio);
        const drawWidth = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
        const drawHeight = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
        canvas.width = drawWidth;
        canvas.height = drawHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.clearRect(0, 0, drawWidth, drawHeight);
        ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = raw;
  });
}

function formatDateMmDdYyyy(dateValue: Date): string {
  const mm = String(dateValue.getMonth() + 1).padStart(2, "0");
  const dd = String(dateValue.getDate()).padStart(2, "0");
  const yyyy = dateValue.getFullYear();
  return `${mm}.${dd}.${yyyy}`;
}

function normalizeDateMmDdYyyy(raw: string | null | undefined): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const yyyy = Number(iso[1]);
    const mm = Number(iso[2]);
    const dd = Number(iso[3]);
    const parsed = new Date(yyyy, mm - 1, dd);
    if (parsed.getFullYear() === yyyy && parsed.getMonth() + 1 === mm && parsed.getDate() === dd) {
      return `${String(mm).padStart(2, "0")}.${String(dd).padStart(2, "0")}.${yyyy}`;
    }
  }
  const delimited = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (delimited) {
    const a = Number(delimited[1]);
    const b = Number(delimited[2]);
    const yyyy = Number(delimited[3]);
    let mm = a;
    let dd = b;
    // Backward-compatible parse for legacy DD/MM/YYYY input.
    if (a > 12 && b <= 12) {
      mm = b;
      dd = a;
    }
    const parsed = new Date(yyyy, mm - 1, dd);
    if (parsed.getFullYear() === yyyy && parsed.getMonth() + 1 === mm && parsed.getDate() === dd) {
      return `${String(mm).padStart(2, "0")}.${String(dd).padStart(2, "0")}.${yyyy}`;
    }
  }
  return "";
}

function normalizeDiscountRateAnnual(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0.08;
  if (Math.abs(parsed - 0.06) < 0.0000001) return 0.08;
  return parsed;
}

function normalizeScenarioDiscountRate<T extends ScenarioInput | ScenarioWithId>(scenario: T): T {
  return {
    ...scenario,
    discount_rate_annual: normalizeDiscountRateAnnual(
      (scenario as ScenarioInput | ScenarioWithId).discount_rate_annual
    ),
  } as T;
}

function normalizeParkingSalesTaxRate(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0.0825;
  return parsed;
}

function normalizeScenarioParkingTax<T extends ScenarioInput | ScenarioWithId>(scenario: T): T {
  return {
    ...scenario,
    parking_sales_tax_rate: normalizeParkingSalesTaxRate(
      (scenario as ScenarioInput | ScenarioWithId).parking_sales_tax_rate
    ),
  } as T;
}

function normalizeScenarioCommission<T extends ScenarioInput | ScenarioWithId>(scenario: T): T {
  const input = scenario as ScenarioInput | ScenarioWithId;
  const rawRate = (input.commission_rate as unknown);
  const parsedRate = Number(rawRate);
  const normalizedRate =
    rawRate === undefined || rawRate === null || String(rawRate).trim() === ""
      ? 0.06
      : (Number.isFinite(parsedRate) && parsedRate >= 0 ? parsedRate : 0.06);
  const commissionRate = Math.min(1, normalizedRate > 1 ? normalizedRate / 100 : normalizedRate);
  const commissionBasis = input.commission_applies_to === "base_rent"
    ? "base_rent"
    : "gross_obligation";
  return {
    ...scenario,
    commission_rate: commissionRate,
    commission_applies_to: commissionBasis,
  } as T;
}

function normalizeScenarioEconomics<T extends ScenarioInput | ScenarioWithId>(scenario: T): T {
  return syncTiFields(
    normalizeScenarioCommission(
      normalizeScenarioParkingTax(normalizeScenarioDiscountRate(scenario))
    )
  ) as T;
}

async function fileToDataUrl(file: File): Promise<string> {
  await file.arrayBuffer(); // Touch the file first so file read failures reject early.
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read blob."));
    reader.readAsDataURL(blob);
  });
}

async function fetchPublicAssetDataUrl(path: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(path, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
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
  const {
    id: _id,
    ti_allowance_source_of_truth: _tiAllowanceSource,
    is_remaining_obligation: _isRemainingObligation,
    remaining_obligation_start_date: _remainingObligationStartDate,
    original_extracted_lease: _originalExtractedLease,
    ...rest
  } = s;
  const tiSource = normalizeTiSourceOfTruth(
    (rest as { ti_source_of_truth?: "psf" | "total" }).ti_source_of_truth,
    "psf"
  );
  const tiAllowancePsf = effectiveTiAllowancePsf(rest);
  const tiBudgetTotal = effectiveTiBudgetTotal(rest);
  const normalizedAbatementPeriods = ((rest as { abatement_periods?: Array<{ start_month?: number; end_month?: number; abatement_type?: string }> }).abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month ?? 0) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month ?? start) || start));
      return {
        start_month: start,
        end_month: end,
        abatement_type: period.abatement_type === "gross" ? "gross" as const : "base" as const,
      };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const normalizedParkingAbatementPeriods = ((rest as { parking_abatement_periods?: Array<{ start_month?: number; end_month?: number }> }).parking_abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month ?? 0) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month ?? start) || start));
      return { start_month: start, end_month: end };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const raw = (rest as { free_rent_months?: number | number[] }).free_rent_months;
  const fallbackFreeRentMonths =
    Array.isArray(raw) ? Math.max(0, raw.length) : typeof raw === "number" ? Math.max(0, Math.floor(raw)) : rest.free_rent_months ?? 0;
  const fallbackStartMonthRaw = Math.max(0, Math.floor(Number((rest as { free_rent_start_month?: number }).free_rent_start_month ?? 0) || 0));
  const fallbackEndMonthDerived = fallbackFreeRentMonths > 0 ? fallbackStartMonthRaw + fallbackFreeRentMonths - 1 : fallbackStartMonthRaw;
  const firstAbatement = normalizedAbatementPeriods[0];
  const free_rent_months = normalizedAbatementPeriods.length > 0
    ? normalizedAbatementPeriods.reduce((sum, period) => sum + Math.max(0, period.end_month - period.start_month + 1), 0)
    : fallbackFreeRentMonths;
  const startMonthRaw = firstAbatement?.start_month ?? fallbackStartMonthRaw;
  const endMonthDerived = firstAbatement?.end_month ?? fallbackEndMonthDerived;
  const freeRentType: "base" | "gross" = firstAbatement?.abatement_type
    ?? ((rest as { free_rent_abatement_type?: string }).free_rent_abatement_type === "gross" ? "gross" : "base");
  const payload: Omit<ScenarioWithId, "id"> = {
    ...rest,
    ti_allowance_psf: tiAllowancePsf,
    ti_budget_total: tiBudgetTotal,
    ti_source_of_truth: tiSource,
    abatement_periods: normalizedAbatementPeriods,
    parking_abatement_periods: normalizedParkingAbatementPeriods,
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

function HomeContent() {
  const searchParams = useSearchParams();
  const {
    ready: workspaceReady,
    session: authSession,
    isAuthenticated,
    activeClient,
    activeClientId,
    registerDocument,
  } = useClientWorkspace();
  const workspaceScopeId = workspaceReady
    ? (activeClientId || (isAuthenticated ? "unselected" : "guest"))
    : "boot";
  const scenariosStorageKey = useMemo(
    () => makeClientScopedStorageKey(SCENARIOS_STATE_KEY, workspaceScopeId),
    [workspaceScopeId],
  );
  const brandStorageKey = useMemo(
    () => makeClientScopedStorageKey(BRAND_ID_STORAGE_KEY, workspaceScopeId),
    [workspaceScopeId],
  );
  const reportMetaStorageKey = useMemo(
    () => makeClientScopedStorageKey(REPORT_META_STATE_KEY, workspaceScopeId),
    [workspaceScopeId],
  );
  const pendingScenarioKey = useMemo(
    () => makeClientScopedStorageKey(PENDING_SCENARIO_KEY, workspaceScopeId),
    [workspaceScopeId],
  );
  const [activePlatformModule, setActivePlatformModule] = useState<PlatformModuleId>(DEFAULT_PLATFORM_MODULE_ID);
  const [activeTopTab, setActiveTopTab] = useState<FinancialAnalysesToolId>("lease-comparison");
  const [scenarios, setScenarios] = useState<ScenarioWithId[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CashflowResult | { error: string }>>({});
  const [exportPdfLoading, setExportPdfLoading] = useState(false);
  const [exportPdfError, setExportPdfError] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string>("default");
  const [globalDiscountRate] = useState(0.08);
  const [exportExcelLoading, setExportExcelLoading] = useState(false);
  const [exportExcelError, setExportExcelError] = useState<string | null>(null);
  const [shareLinkStatus, setShareLinkStatus] = useState<string | null>(null);
  const [shareLinkError, setShareLinkError] = useState<string | null>(null);
  const [customChartsForExport, setCustomChartsForExport] = useState<CustomChartExportConfig[]>([]);
  const [reportMeta, setReportMeta] = useState<{
    prepared_for: string;
    prepared_by: string;
    report_date: string;
    market: string;
    submarket: string;
  }>({
    prepared_for: "",
    prepared_by: "",
    report_date: "",
    market: "",
    submarket: "",
  });
  const [equalizedCustomWindow, setEqualizedCustomWindow] = useState<EqualizedWindowInput>({
    start: "",
    end: "",
  });
  const [organizationBranding, setOrganizationBranding] = useState<UserBrandingResponse | null>(null);
  const [brokerageName, setBrokerageName] = useState("");
  const [brandingLoading, setBrandingLoading] = useState(false);
  const [clientLogoDataUrl, setClientLogoDataUrl] = useState<string | null>(null);
  const [clientLogoFileName, setClientLogoFileName] = useState<string | null>(null);
  const [clientLogoUploading, setClientLogoUploading] = useState(false);
  const [clientLogoError, setClientLogoError] = useState<string | null>(null);
  const defaultBrokerageLogoPromiseRef = useRef<Promise<string | null> | null>(null);
  const computeRequestEpochRef = useRef<Record<string, number>>({});
  const [includedInSummary, setIncludedInSummary] = useState<Record<string, boolean>>({});
  const [canonicalComputeCache, setCanonicalComputeCache] = useState<Record<string, CanonicalComputeResponse>>({});
  const isProduction = typeof process !== "undefined" && process.env.NODE_ENV === "production";
  const rawModuleParam = String(searchParams?.get("module") || "").trim().toLowerCase();

  const selectedScenario = scenarios.find((s) => s.id === selectedId) ?? null;
  const defaultPreparedByFromAuth = useMemo(
    () => derivePreparedByFromSession(authSession),
    [authSession]
  );

  useEffect(() => {
    const resolved = resolveActivePlatformModule(rawModuleParam, Boolean(authSession));
    if (activePlatformModule !== resolved) setActivePlatformModule(resolved);
  }, [rawModuleParam, authSession, activePlatformModule]);

  const getDefaultBrokerageLogoDataUrl = useCallback(async (): Promise<string | null> => {
    if (!defaultBrokerageLogoPromiseRef.current) {
      defaultBrokerageLogoPromiseRef.current = fetchPublicAssetDataUrl(CRE_DEFAULT_LOGO_PUBLIC_PATH);
    }
    return await defaultBrokerageLogoPromiseRef.current;
  }, []);

  const [hasRestored, setHasRestored] = useState(false);
  useEffect(() => {
    if (!workspaceReady) return;
    setScenarios([]);
    setSelectedId(null);
    setResults({});
    setCanonicalComputeCache({});
    setIncludedInSummary({});
    computeRequestEpochRef.current = {};
    setHasRestored(false);
  }, [scenariosStorageKey, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || hasRestored || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(scenariosStorageKey);
      if (!raw) {
        setHasRestored(true);
        return;
      }
      const data = JSON.parse(raw) as { scenarios?: ScenarioWithId[]; includedInSummary?: Record<string, boolean> };
      if (Array.isArray(data.scenarios) && data.scenarios.length > 0) {
        const restoredScenarios = data.scenarios.map((s) =>
          normalizeScenarioEconomics({ ...s, clientId: workspaceScopeId }),
        );
        setScenarios(restoredScenarios);
        setSelectedId(null);
      }
      if (data.includedInSummary && typeof data.includedInSummary === "object") setIncludedInSummary(data.includedInSummary);
      setHasRestored(true);
    } catch {
      setHasRestored(true);
    }
  }, [hasRestored, scenariosStorageKey, workspaceScopeId, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || typeof window === "undefined" || !hasRestored) return;
    const included: Record<string, boolean> = {};
    scenarios.forEach((s) => {
      included[s.id] = includedInSummary[s.id] !== false;
    });
    try {
      localStorage.setItem(
        scenariosStorageKey,
        JSON.stringify({ scenarios, includedInSummary: included })
      );
    } catch {
      // ignore
    }
  }, [scenarios, includedInSummary, hasRestored, scenariosStorageKey, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !hasRestored) return;
    setScenarios((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        const normalized = normalizeScenarioEconomics(s);
        if (
          normalized.discount_rate_annual !== s.discount_rate_annual ||
          normalized.parking_sales_tax_rate !== s.parking_sales_tax_rate ||
          normalized.ti_allowance_psf !== s.ti_allowance_psf ||
          normalized.ti_allowance_source_of_truth !== s.ti_allowance_source_of_truth ||
          normalized.ti_budget_total !== s.ti_budget_total ||
          normalized.ti_source_of_truth !== s.ti_source_of_truth
        ) {
          changed = true;
          return normalized;
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, [hasRestored, workspaceReady]);

  useEffect(() => {
    if (typeof window === "undefined" || !isProduction || scenarios.length === 0) return;
    const missing = scenarios.filter((s) => !canonicalComputeCache[s.id]);
    if (missing.length === 0) return;
    missing.forEach((s) => {
      const epoch = (computeRequestEpochRef.current[s.id] ?? 0) + 1;
      computeRequestEpochRef.current[s.id] = epoch;
      const canonical = scenarioInputToBackendCanonical(s, s.id, s.name);
      fetchComputeCanonical(s.id, canonical)
        .then((res) => {
          if (!res.ok) return;
          return res.json() as Promise<CanonicalComputeResponse>;
        })
        .then((data) => {
          if (!data) return;
          if ((computeRequestEpochRef.current[s.id] ?? 0) !== epoch) return;
          setCanonicalComputeCache((prev) => ({ ...prev, [s.id]: data }));
          setResults((prev) => ({
            ...prev,
            [s.id]: {
              term_months: data.metrics.term_months,
              rent_nominal: data.metrics.base_rent_total,
              opex_nominal: data.metrics.opex_total,
              total_cost_nominal: data.metrics.total_obligation_nominal,
              npv_cost: data.metrics.npv_cost,
              avg_cost_year: data.metrics.total_obligation_nominal / (data.metrics.term_months / 12 || 1),
              avg_cost_psf_year: data.metrics.avg_all_in_cost_psf_year,
            },
          }));
        })
        .catch(() => {});
    });
  }, [scenarios, isProduction, canonicalComputeCache]);

  useEffect(() => {
    if (!workspaceReady || typeof window === "undefined") return;
    setBrandId("default");
    try {
      const s = localStorage.getItem(brandStorageKey);
      if (s) setBrandId(s);
    } catch {
      // ignore localStorage failures
    }
  }, [brandStorageKey, workspaceReady]);

  useEffect(() => {
    if (workspaceReady && typeof window !== "undefined" && brandId) {
      localStorage.setItem(brandStorageKey, brandId);
    }
  }, [brandId, brandStorageKey, workspaceReady]);

  const loadOrganizationBranding = useCallback(async () => {
    if (!authSession) {
      setOrganizationBranding(null);
      setBrokerageName("");
      return;
    }
    setBrandingLoading(true);
    try {
      const data = await fetchUserBranding();
      setOrganizationBranding(data);
      setBrokerageName((data.brokerage_name || "").trim());
    } catch (err) {
      setOrganizationBranding(null);
      console.warn("[branding] unable to load org branding", err);
    } finally {
      setBrandingLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    if (!authSession) {
      setOrganizationBranding(null);
      setBrokerageName("");
      setClientLogoDataUrl(null);
      setClientLogoFileName(null);
      setClientLogoError(null);
      return;
    }
    void loadOrganizationBranding();
  }, [authSession, loadOrganizationBranding]);

  useEffect(() => {
    if (!defaultPreparedByFromAuth) return;
    setReportMeta((prev) => {
      if (prev.prepared_by.trim()) return prev;
      return { ...prev, prepared_by: defaultPreparedByFromAuth };
    });
  }, [defaultPreparedByFromAuth]);

  useEffect(() => {
    if (!workspaceReady || typeof window === "undefined") return;
    setReportMeta({
      prepared_for: activeClient?.name || "",
      prepared_by: "",
      report_date: "",
      market: "",
      submarket: "",
    });
    setClientLogoDataUrl(null);
    setClientLogoFileName(null);
    try {
      const raw = localStorage.getItem(reportMetaStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        reportMeta?: Partial<{
          prepared_for: string;
          prepared_by: string;
          report_date: string;
          market: string;
          submarket: string;
        }>;
        clientLogoDataUrl?: string | null;
        clientLogoFileName?: string | null;
      };
      if (parsed.reportMeta && typeof parsed.reportMeta === "object") {
        setReportMeta({
          prepared_for: String(parsed.reportMeta.prepared_for || activeClient?.name || "").trim(),
          prepared_by: String(parsed.reportMeta.prepared_by || "").trim(),
          report_date: String(parsed.reportMeta.report_date || "").trim(),
          market: String(parsed.reportMeta.market || "").trim(),
          submarket: String(parsed.reportMeta.submarket || "").trim(),
        });
      }
      setClientLogoDataUrl(parsed.clientLogoDataUrl || null);
      setClientLogoFileName(parsed.clientLogoFileName || null);
    } catch {
      // ignore parse errors
    }
  }, [reportMetaStorageKey, activeClient?.name, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || typeof window === "undefined") return;
    try {
      localStorage.setItem(
        reportMetaStorageKey,
        JSON.stringify({
          reportMeta,
          clientLogoDataUrl,
          clientLogoFileName,
        }),
      );
    } catch {
      // ignore storage limits
    }
  }, [reportMetaStorageKey, reportMeta, clientLogoDataUrl, clientLogoFileName, workspaceReady]);

  const uploadClientLogo = useCallback(async (file: File) => {
    if (!authSession) {
      setClientLogoError("Sign in to upload a client logo.");
      return;
    }
    const mime = (file.type || "").toLowerCase();
    if (!["image/png", "image/jpeg", "image/jpg", "image/svg+xml"].includes(mime)) {
      setClientLogoError("Client logo must be PNG, SVG, or JPG.");
      return;
    }
    if (file.size > 1_500_000) {
      setClientLogoError("Client logo must be 1.5MB or smaller.");
      return;
    }
    setClientLogoUploading(true);
    setClientLogoError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setClientLogoDataUrl(dataUrl || null);
      setClientLogoFileName(file.name || null);
    } catch (err) {
      setClientLogoError(getDisplayErrorMessage(err));
    } finally {
      setClientLogoUploading(false);
    }
  }, [authSession]);

  const clearClientLogo = useCallback(() => {
    setClientLogoDataUrl(null);
    setClientLogoFileName(null);
    setClientLogoError(null);
  }, []);

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
      const epoch = (computeRequestEpochRef.current[scenario.id] ?? 0) + 1;
      computeRequestEpochRef.current[scenario.id] = epoch;
      const canonical = scenarioInputToBackendCanonical(scenario, scenario.id, scenario.name);
      try {
        const res = await fetchComputeCanonical(scenario.id, canonical);
        if (!res.ok) return;
        const data = (await res.json()) as CanonicalComputeResponse;
        if ((computeRequestEpochRef.current[scenario.id] ?? 0) !== epoch) return;
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
    (
      canonical: BackendCanonicalLease,
      onAdded?: (s: ScenarioWithId) => void,
      preferredName?: string
    ) => {
      let scenarioInput = normalizeScenarioEconomics(backendCanonicalToScenarioInput(canonical, preferredName));
      scenarioInput = normalizeScenarioEconomics({ ...scenarioInput, clientId: workspaceScopeId });
      if (hasCommencementBeforeToday(scenarioInput.commencement)) {
        scenarioInput = normalizeScenarioEconomics(applyLeaseModelChoice(scenarioInput, "remaining_obligation"));
      }
      let scenarioWithId: ScenarioWithId = normalizeScenarioEconomics({ id: nextId(), ...scenarioInput });
      let cacheInvalidationIds: string[] = [scenarioWithId.id];
      setScenarios((prev) => {
        const merged = [...prev, scenarioWithId];
        const harmonized = harmonizeExtractedScenarios(merged).map((s) => normalizeScenarioEconomics(s));
        const previousById = new Map(merged.map((s) => [s.id, s]));
        cacheInvalidationIds = harmonized
          .filter((s) => {
            const before = previousById.get(s.id);
            if (!before) return false;
            return (
              String(before.suite || "") !== String(s.suite || "")
              || Number(before.base_opex_psf_yr || 0) !== Number(s.base_opex_psf_yr || 0)
              || Number(before.base_year_opex_psf_yr || 0) !== Number(s.base_year_opex_psf_yr || 0)
            );
          })
          .map((s) => s.id);
        if (!cacheInvalidationIds.includes(scenarioWithId.id)) {
          cacheInvalidationIds.push(scenarioWithId.id);
        }
        scenarioWithId = harmonized.find((s) => s.id === scenarioWithId.id) ?? scenarioWithId;
        return harmonized;
      });
      setSelectedId(null);
      setResults((prev) => {
        const next = { ...prev };
        for (const id of cacheInvalidationIds) {
          delete next[id];
        }
        return next;
      });
      setCanonicalComputeCache((prev) => {
        const next = { ...prev };
        for (const id of cacheInvalidationIds) {
          delete next[id];
        }
        return next;
      });
      setExtractError(null);
      onAdded?.(scenarioWithId);
    },
    [workspaceScopeId]
  );

  const handleNormalizeSuccess = useCallback(
    async (
      data: NormalizerResponse,
      source?: {
        name?: string;
        file?: File | null;
        sourceModule?: "financial-analyses" | "sublease-recovery" | "upload";
        skipDocumentRegister?: boolean;
      },
    ) => {
      const hasCanonical = !!data?.canonical_lease;
      console.log("[compute] about to call", { hasCanonical });
      setExtractError(null);

      if (!data.canonical_lease) {
        console.log("[compute] skip: no canonical_lease");
        setExtractError("Extraction completed, but no lease payload was returned. Please retry the upload.");
        return;
      }

      const canonical = data.canonical_lease;
      if (!source?.skipDocumentRegister && activeClientId) {
        await registerDocument({
          clientId: activeClientId,
          name: source?.name || `Lease ${formatDateISO(new Date())}`,
          file: source?.file,
          sourceModule: source?.sourceModule || "financial-analyses",
          normalize: data,
          parsed: true,
        });
      }
      const documentTypeDetected = (data.extraction_summary?.document_type_detected || "unknown").trim();
      const canonicalWithDocType: BackendCanonicalLease = {
        ...canonical,
        document_type_detected: documentTypeDetected || "unknown",
      };
      const optionVariantsWithDocType = (Array.isArray(data.option_variants) ? data.option_variants : []).map((variant) => ({
        ...variant,
        document_type_detected: documentTypeDetected || "unknown",
      }));
      const canonicalVariants = collectCanonicalVariants(canonicalWithDocType, optionVariantsWithDocType);
      const totalVariants = canonicalVariants.length;
      canonicalVariants.forEach((variant, index) => {
        const preferredName = canonicalDisplayNameForAdd(variant, index, totalVariants);
        addScenarioFromCanonical(
          variant,
          (newScenario) => {
            console.log("[compute] about to run", {
              scenarioId: newScenario.id,
              lease_type: (variant as { lease_type?: string })?.lease_type ?? "NNN",
              document_type_detected: (variant as { document_type_detected?: string })?.document_type_detected ?? "unknown",
            });
            runComputeForScenario(newScenario);
          },
          preferredName || undefined
        );
      });
    },
    [addScenarioFromCanonical, runComputeForScenario, activeClientId, registerDocument]
  );

  const handleExtractError = useCallback((message: string) => {
    setExtractError(message || null);
  }, []);

  const handleExistingDocumentSelection = useCallback((document: ClientWorkspaceDocument) => {
    const snapshot = document.normalizeSnapshot;
    if (!snapshot?.canonical_lease) {
      setExtractError("Selected document has no parsed payload. Upload or parse the file first.");
      return;
    }
      const payload: NormalizerResponse = {
      canonical_lease: snapshot.canonical_lease,
      option_variants: snapshot.option_variants || [],
      confidence_score: Number(snapshot.confidence_score || 0),
      field_confidence: snapshot.field_confidence || {},
      missing_fields: [],
      clarification_questions: [],
      warnings: snapshot.warnings || [],
      extraction_summary: snapshot.extraction_summary,
      review_tasks: snapshot.review_tasks || [],
    };
    void handleNormalizeSuccess(payload, {
      name: document.name,
      sourceModule: "financial-analyses",
      skipDocumentRegister: true,
    });
  }, [handleNormalizeSuccess]);

  useEffect(() => {
    if (!workspaceReady) return;
    try {
      const raw = sessionStorage.getItem(pendingScenarioKey);
      if (!raw) return;
      sessionStorage.removeItem(pendingScenarioKey);
      const scenarioInput: ScenarioInput = JSON.parse(raw);
      const withId: ScenarioWithId = normalizeScenarioEconomics({ id: nextId(), ...scenarioInput, clientId: workspaceScopeId });
      setScenarios((prev) => [...prev, withId]);
      setSelectedId(null);
    } catch {
      // ignore invalid or missing
    }
  }, [workspaceScopeId, pendingScenarioKey, workspaceReady]);

  const addScenario = useCallback(() => {
    const newScenario: ScenarioWithId = normalizeScenarioEconomics({
      id: nextId(),
      clientId: workspaceScopeId,
      ...defaultScenarioInput,
      discount_rate_annual: globalDiscountRate,
    });
    setScenarios((prev) => [...prev, newScenario]);
    setSelectedId(null);
    setResults((prev) => {
      const next = { ...prev };
      delete next[newScenario.id];
      return next;
    });
  }, [globalDiscountRate, workspaceScopeId]);

  const duplicateScenario = useCallback(() => {
    if (!selectedScenario) return;
    const copy: ScenarioWithId = {
      ...selectedScenario,
      id: nextId(),
      name: `${selectedScenario.name} (copy)`,
    };
    setScenarios((prev) => [...prev, copy]);
    setResults((prev) => {
      const next = { ...prev };
      delete next[copy.id];
      return next;
    });
  }, [selectedScenario]);

  const deleteScenario = useCallback((id: string) => {
    delete computeRequestEpochRef.current[id];
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setCanonicalComputeCache((prev) => {
      if (!(id in prev)) return prev;
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
    setResults((prev) => {
      const next = { ...prev };
      delete next[copy.id];
      return next;
    });
  }, [scenarios]);

  const updateScenario = useCallback((updated: ScenarioWithId) => {
    const normalized = normalizeScenarioEconomics(updated);
    computeRequestEpochRef.current[normalized.id] = (computeRequestEpochRef.current[normalized.id] ?? 0) + 1;
    setScenarios((prev) =>
      prev.map((s) => (s.id === normalized.id ? normalized : s))
    );
    // Invalidate stale compute outputs so summaries/charts reflect latest edits.
    setResults((prev) => {
      if (!(normalized.id in prev)) return prev;
      const next = { ...prev };
      delete next[normalized.id];
      return next;
    });
    setCanonicalComputeCache((prev) => {
      if (!(normalized.id in prev)) return prev;
      const next = { ...prev };
      delete next[normalized.id];
      return next;
    });
    if (isProduction) {
      void runComputeForScenario(normalized);
    }
  }, [isProduction, runComputeForScenario]);

  const updateScenarioTiBudgetPsf = useCallback(
    (scenarioId: string, tiBudgetPsf: number) => {
      const current = scenarios.find((s) => s.id === scenarioId);
      if (!current) return;
      const rsf = Math.max(0, Number(current.rsf) || 0);
      if (rsf <= 0) return;
      const nextPsf = Math.max(0, Number(tiBudgetPsf) || 0);
      const nextBudgetTotal = round0(nextPsf * rsf);
      const updatedScenario = normalizeScenarioEconomics({
        ...current,
        ti_budget_total: nextBudgetTotal,
        ti_source_of_truth: "psf",
      });
      updateScenario(updatedScenario);
    },
    [scenarios, updateScenario]
  );

  const updateScenarioCommissionRate = useCallback(
    (scenarioId: string, commissionRate: number) => {
      const current = scenarios.find((s) => s.id === scenarioId);
      if (!current) return;
      const nextRate = Math.max(0, Number(commissionRate) || 0);
      const updatedScenario = normalizeScenarioEconomics({
        ...current,
        commission_rate: nextRate,
      });
      updateScenario(updatedScenario);
    },
    [scenarios, updateScenario]
  );

  const updateScenarioCommissionBasis = useCallback(
    (scenarioId: string, commissionBasis: "base_rent" | "gross_obligation") => {
      const current = scenarios.find((s) => s.id === scenarioId);
      if (!current) return;
      const updatedScenario = normalizeScenarioEconomics({
        ...current,
        commission_applies_to: commissionBasis === "gross_obligation" ? "gross_obligation" : "base_rent",
      });
      updateScenario(updatedScenario);
    },
    [scenarios, updateScenario]
  );

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

  const changeScenarioObligationMode = useCallback(
    (id: string, mode: "full_original_term" | "remaining_obligation") => {
      const current = scenarios.find((s) => s.id === id);
      if (!current?.original_extracted_lease) return;
      const sourceCommencement = String(
        current.original_extracted_lease.commencement || current.commencement || ""
      );
      if (!hasCommencementBeforeToday(sourceCommencement)) return;
      const isCurrentlyRemaining = Boolean(current.is_remaining_obligation);
      const wantsRemaining = mode === "remaining_obligation";
      if (isCurrentlyRemaining === wantsRemaining) return;

      const modeled = normalizeScenarioEconomics(applyLeaseModelChoice(current, mode));
      const updatedScenario: ScenarioWithId = { ...modeled, id: current.id };
      updateScenario(updatedScenario);
    },
    [scenarios, updateScenario]
  );

  const inferredReportLocation = useMemo(() => {
    const ordered = selectedScenario
      ? [selectedScenario, ...scenarios.filter((s) => s.id !== selectedScenario.id)]
      : [...scenarios];
    const marketCandidates: string[] = [];
    const submarketCandidates: string[] = [];
    const addressCandidates: string[] = [];

    for (const s of ordered) {
      const cached = canonicalComputeCache[s.id];
      const normalized = (cached?.normalized_canonical_lease ?? {}) as Record<string, unknown>;
      const metrics = cached?.metrics;
      marketCandidates.push(cleanMaybeString(normalized.market));
      marketCandidates.push(cleanMaybeString(metrics?.market));
      marketCandidates.push(cleanMaybeString((s as unknown as Record<string, unknown>).market));
      submarketCandidates.push(cleanMaybeString(normalized.submarket));
      submarketCandidates.push(cleanMaybeString(metrics?.submarket));
      submarketCandidates.push(cleanMaybeString((s as unknown as Record<string, unknown>).submarket));
      addressCandidates.push(cleanMaybeString(normalized.address));
      addressCandidates.push(cleanMaybeString(metrics?.address));
      addressCandidates.push(cleanMaybeString(s.address));
    }

    const marketFromApi = marketCandidates.find((v) => v.length > 0) || "";
    const submarketFromApi = submarketCandidates.find((v) => v.length > 0) || "";
    const marketFromAddress =
      addressCandidates
        .map((addr) => inferMarketFromAddress(addr))
        .find((v) => v.length > 0) || "";

    return {
      market: marketFromApi || marketFromAddress || "",
      submarket: submarketFromApi || "",
    };
  }, [selectedScenario, scenarios, canonicalComputeCache]);

  const buildReportMeta = useCallback((): ReportMeta => {
    const todayMdy = formatDateMmDdYyyy(new Date());
    const defaultPreparedBy = reportMeta.prepared_by.trim() || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY;
    return {
      prepared_for: reportMeta.prepared_for.trim() || "Client",
      prepared_by: defaultPreparedBy,
      report_date: normalizeDateMmDdYyyy(reportMeta.report_date) || todayMdy,
      market: reportMeta.market.trim() || inferredReportLocation.market || "",
      submarket: reportMeta.submarket.trim() || inferredReportLocation.submarket || "",
      confidential: true,
    };
  }, [reportMeta, defaultPreparedByFromAuth, inferredReportLocation.market, inferredReportLocation.submarket]);

  const buildExportFileName = useCallback(
    (kind: "xlsx" | "pdf", meta: ReportMeta): string => {
      const resolvedBrokerageName = authSession
        ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
        : CRE_DEFAULT_BROKERAGE_NAME;
      return buildPlatformExportFileName({
        kind,
        brokerageName: resolvedBrokerageName,
        clientName: meta.prepared_for || "Client",
        reportDate: meta.report_date,
        excelDescriptor: "Financial Analysis",
        pdfDescriptor: "Economic Presentation",
      });
    },
    [authSession, organizationBranding]
  );

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

  const includedScenarios = useMemo(
    () => scenarios.filter((s) => includedInSummary[s.id] !== false),
    [scenarios, includedInSummary]
  );
  const scenariosById = useMemo<Record<string, ScenarioWithId>>(
    () =>
      scenarios.reduce<Record<string, ScenarioWithId>>((acc, scenario) => {
        acc[scenario.id] = scenario;
        return acc;
      }, {}),
    [scenarios]
  );

  const equalizedUi = useMemo(
    () => computeEqualizedComparison(includedScenarios, globalDiscountRate, equalizedCustomWindow),
    [includedScenarios, globalDiscountRate, equalizedCustomWindow]
  );

  const equalizedForExport = useMemo(
    () => computeEqualizedComparison(scenarios, globalDiscountRate, equalizedCustomWindow),
    [scenarios, globalDiscountRate, equalizedCustomWindow]
  );

  const exportPdfDeck = useCallback(async () => {
    if (scenarios.length === 0) {
      setExportPdfError("Add at least one scenario.");
      return;
    }
    const tiRsfIssue = scenarios.find(
      (s) =>
        !hasValidRsfForTi(s.rsf) &&
        (effectiveTiBudgetTotal(s) > 0 || effectiveTiAllowancePsf(s) > 0)
    );
    if (tiRsfIssue) {
      setExportPdfError(`Fix RSF before export for "${tiRsfIssue.name}". Enter RSF to calculate TI.`);
      return;
    }
    setExportPdfLoading(true);
    setExportPdfError(null);
    setShareLinkStatus(null);
    setShareLinkError(null);
    try {
      const clientLogoBase64 = extractDataUrlBase64(clientLogoDataUrl);
      const clientLogoUrl =
        clientLogoBase64 || !clientLogoDataUrl || clientLogoDataUrl.startsWith("data:image/")
          ? undefined
          : clientLogoDataUrl;
      if (equalizedForExport.needsCustomWindow) {
        setExportPdfError(
          "No overlapping lease term for equalized comparison. Enter a custom comparison start and end date."
        );
        return;
      }
      const scenariosForDeck = scenarios.map((s) => {
        const equalized = equalizedForExport.metricsByScenario[s.id];
        const baseResult = getScenarioResultForExport(s);
        return {
          scenario: scenarioToPayload(s),
          result: {
            ...baseResult,
            equalized_start: equalizedForExport.windowStart || undefined,
            equalized_end: equalizedForExport.windowEnd || undefined,
            equalized_window_days: equalizedForExport.windowDays || undefined,
            equalized_window_month_count: equalizedForExport.windowMonthCount || undefined,
            equalized_window_source: equalizedForExport.windowSource,
            equalized_avg_gross_rent_psf_year: equalized?.averageGrossRentPsfYear ?? undefined,
            equalized_avg_gross_rent_month: equalized?.averageGrossRentMonth ?? undefined,
            equalized_avg_cost_psf_year: equalized?.averageCostPsfYear ?? undefined,
            equalized_avg_cost_year: equalized?.averageCostYear ?? undefined,
            equalized_avg_cost_month: equalized?.averageCostMonth ?? undefined,
            equalized_total_cost: equalized?.totalCost ?? undefined,
            equalized_npv_cost: equalized?.npvCost ?? undefined,
            equalized_no_overlap: equalizedForExport.needsCustomWindow,
          },
        };
      });
      const meta = buildReportMeta();
      const pdfFileName = buildExportFileName("pdf", meta);
      const resolvedPreparedBy = meta.prepared_by || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY;
      const headers = getAuthHeaders();
      const deckPayload = {
        scenarios: scenariosForDeck,
        branding: {
          client_name: meta.prepared_for || "Client",
          prepared_by_name: resolvedPreparedBy,
          date: meta.report_date || formatDateMmDdYyyy(new Date()),
          market: meta.market || "",
          submarket: meta.submarket || "",
          client_logo_asset_url: clientLogoUrl,
          client_logo_asset_bytes: clientLogoBase64 || undefined,
          confidentiality_line: meta.confidential ? "Confidential" : "",
        },
        custom_charts: customChartsForExport,
      };
      try {
        const res = await fetchApiProxy("/reports", {
          method: "POST",
          headers,
          body: JSON.stringify(deckPayload),
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
        downloadBlobFile(blob, pdfFileName);
        return;
      } catch (deckErr) {
        const msg = deckErr instanceof Error ? deckErr.message : String(deckErr);
        console.error("[exportPdfDeck] deck route failed:", msg.slice(0, 600));
      }

      // Direct multi-scenario deck route fallback (no persisted report_id hop).
      try {
        const directDeck = await fetchApiProxy("/report/deck", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify(deckPayload),
        });
        if (directDeck.ok) {
          const blob = await directDeck.blob();
          downloadBlobFile(blob, pdfFileName);
          return;
        }
      } catch (directDeckErr) {
        const msg = directDeckErr instanceof Error ? directDeckErr.message : String(directDeckErr);
        console.error("[exportPdfDeck] direct /report/deck fallback failed:", msg.slice(0, 600));
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
              meta,
            }),
          });
          if (direct.ok) {
            const blob = await direct.blob();
            downloadBlobFile(blob, pdfFileName);
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
      setExportPdfError(parseErrorPayloadText(msg) || "PDF export failed on backend. Please try again.");
    } finally {
      setExportPdfLoading(false);
    }
  }, [scenarios, selectedScenario, brandId, buildReportMeta, buildExportFileName, getScenarioResultForExport, organizationBranding, clientLogoDataUrl, defaultPreparedByFromAuth, equalizedForExport, authSession, customChartsForExport]);

  const exportExcelDeck = useCallback(async () => {
    if (scenarios.length === 0) {
      setExportExcelError("Add at least one scenario.");
      return;
    }
    const tiRsfIssue = scenarios.find(
      (s) =>
        !hasValidRsfForTi(s.rsf) &&
        (effectiveTiBudgetTotal(s) > 0 || effectiveTiAllowancePsf(s) > 0)
    );
    if (tiRsfIssue) {
      setExportExcelError(`Fix RSF before export for "${tiRsfIssue.name}". Enter RSF to calculate TI.`);
      return;
    }
    setExportExcelLoading(true);
    setExportExcelError(null);
    setShareLinkStatus(null);
    setShareLinkError(null);
    try {
      const canonical = scenarios.map(scenarioToCanonical);
      const reportMeta = buildReportMeta();
      const excelFileName = buildExportFileName("xlsx", reportMeta);
      const hasSavedBrokerageBranding = Boolean(
        authSession && organizationBranding?.has_logo && (
          organizationBranding?.logo_data_url || organizationBranding?.logo_asset_bytes
        )
      );
      const resolvedBrokerageName = authSession
        ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
        : CRE_DEFAULT_BROKERAGE_NAME;
      const resolvedPreparedBy = reportMeta.prepared_by || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY;
      const savedBrokerageLogo = authSession
        ? (organizationBranding?.logo_data_url
          || (organizationBranding?.logo_asset_bytes
            ? `data:${organizationBranding.logo_content_type || "image/png"};base64,${organizationBranding.logo_asset_bytes}`
            : null))
        : null;
      const fallbackBrokerageLogo = await getDefaultBrokerageLogoDataUrl();
      const brokerageLogoSource = hasSavedBrokerageBranding
        ? (savedBrokerageLogo || fallbackBrokerageLogo)
        : fallbackBrokerageLogo;
      const clientLogoSource = authSession ? clientLogoDataUrl : null;
      const [brokerageLogoForExcel, clientLogoForExcel] = await Promise.all([
        normalizeLogoDataUrlForExcel(brokerageLogoSource),
        normalizeLogoDataUrlForExcel(clientLogoSource),
      ]);
      const excelMeta = {
        brokerageName: resolvedBrokerageName,
        clientName: reportMeta.prepared_for || "Client",
        reportDate: reportMeta.report_date || undefined,
        preparedBy: resolvedPreparedBy,
        market: (reportMeta.market ?? "").trim() || undefined,
        submarket: (reportMeta.submarket ?? "").trim() || undefined,
        brokerageLogoDataUrl: brokerageLogoForExcel,
        clientLogoDataUrl: clientLogoForExcel,
        customCharts: customChartsForExport,
      };
      let buffer: ArrayBuffer | null = null;
      let usedFallback = false;
      try {
        if (isProduction && scenarios.every((s) => canonicalComputeCache[s.id])) {
          const items = scenarios.map((s) => {
            const res = canonicalComputeCache[s.id]!;
            const sourceEngine = runMonthlyEngine(scenarioToCanonical(s), Number(s.discount_rate_annual ?? globalDiscountRate) || globalDiscountRate);
            const scenarioName = getPremisesDisplayName({
              building_name: res.metrics.building_name,
              suite: res.metrics.suite,
              floor: res.metrics.floor,
              premises_name: res.metrics.premises_name,
              scenario_name: s.name,
            });
            return {
              response: res,
              scenarioName,
              documentTypeDetected: (s.document_type_detected ?? "").trim() || "unknown",
              sourceRsf: Math.max(0, Number(s.rsf) || 0),
              sourceTiBudgetTotal: effectiveTiBudgetTotal(s),
              sourceTiAllowancePsf: effectiveTiAllowancePsf(s),
              sourceCommissionRate: Math.max(0, Number(s.commission_rate) || 0),
              sourceCommissionAppliesTo:
                (s.commission_applies_to === "gross_obligation" ? "gross_obligation" : "base_rent") as
                  "gross_obligation" | "base_rent",
              sourceCommissionAmount: Math.max(0, Number(sourceEngine.metrics.commissionAmount) || 0),
              sourceIsRemainingObligation: Boolean(s.is_remaining_obligation),
            };
          });
          buffer = await buildBrokerWorkbookFromCanonicalResponses(items, excelMeta);
        } else {
          buffer = await buildBrokerWorkbook(canonical, globalDiscountRate, excelMeta);
        }
      } catch (primaryErr) {
        console.error("[exportExcelDeck] broker workbook failed with full branding; retrying formula workbook without logos", primaryErr);
        try {
          const formulaSafeMeta = {
            ...excelMeta,
            brokerageLogoDataUrl: null,
            clientLogoDataUrl: null,
          };
          if (isProduction && scenarios.every((s) => canonicalComputeCache[s.id])) {
            const items = scenarios.map((s) => {
              const res = canonicalComputeCache[s.id]!;
              const sourceEngine = runMonthlyEngine(scenarioToCanonical(s), Number(s.discount_rate_annual ?? globalDiscountRate) || globalDiscountRate);
              const scenarioName = getPremisesDisplayName({
                building_name: res.metrics.building_name,
                suite: res.metrics.suite,
                floor: res.metrics.floor,
                premises_name: res.metrics.premises_name,
                scenario_name: s.name,
              });
              return {
                response: res,
                scenarioName,
                documentTypeDetected: (s.document_type_detected ?? "").trim() || "unknown",
                sourceRsf: Math.max(0, Number(s.rsf) || 0),
                sourceTiBudgetTotal: effectiveTiBudgetTotal(s),
                sourceTiAllowancePsf: effectiveTiAllowancePsf(s),
                sourceCommissionRate: Math.max(0, Number(s.commission_rate) || 0),
                sourceCommissionAppliesTo:
                  (s.commission_applies_to === "gross_obligation" ? "gross_obligation" : "base_rent") as
                    "gross_obligation" | "base_rent",
                sourceCommissionAmount: Math.max(0, Number(sourceEngine.metrics.commissionAmount) || 0),
                sourceIsRemainingObligation: Boolean(s.is_remaining_obligation),
              };
            });
            buffer = await buildBrokerWorkbookFromCanonicalResponses(items, formulaSafeMeta);
          } else {
            buffer = await buildBrokerWorkbook(canonical, globalDiscountRate, formulaSafeMeta);
          }
          usedFallback = true;
        } catch (secondaryErr) {
          console.error("[exportExcelDeck] formula workbook retry failed; skipping legacy fallback to preserve formula-based export", secondaryErr);
          throw secondaryErr;
        }
      }
      downloadBlobFile(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        excelFileName
      );
      if (usedFallback) {
        setExportExcelError("Downloaded Excel using formula fallback (logos removed) because the primary branded export failed.");
      }
    } catch (err) {
      console.error("[exportExcelDeck] fatal export error", err);
      setExportExcelError(getDisplayErrorMessage(err));
    } finally {
      setExportExcelLoading(false);
    }
  }, [scenarios, globalDiscountRate, isProduction, canonicalComputeCache, buildReportMeta, buildExportFileName, defaultPreparedByFromAuth, organizationBranding, clientLogoDataUrl, authSession, getDefaultBrokerageLogoDataUrl, customChartsForExport]);

  const copyFinancialAnalysisShareLink = useCallback(async () => {
    if (includedScenarios.length === 0 || typeof navigator === "undefined") {
      setShareLinkError("Add at least one included scenario.");
      setShareLinkStatus(null);
      return;
    }
    setShareLinkError(null);
    setShareLinkStatus(null);
    try {
      const meta = buildReportMeta();
      const resolvedBrokerageName = authSession
        ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
        : CRE_DEFAULT_BROKERAGE_NAME;
      const scenariosForShare = includedScenarios.map((scenario) => {
        const result = getScenarioResultForExport(scenario);
        const cached = canonicalComputeCache[scenario.id];
        const metrics = cached?.metrics;
        const suiteFloor = [String(metrics?.suite || "").trim(), String(metrics?.floor || "").trim()].filter(Boolean).join(" / ");
        const equalized = equalizedUi.metricsByScenario[scenario.id];
        return {
          id: scenario.id,
          scenarioName: scenario.name,
          documentType: String(scenario.document_type_detected || "unknown").trim() || "unknown",
          buildingName: String(metrics?.building_name || scenario.building_name || "").trim(),
          suiteFloor: suiteFloor || String(scenario.suite || "").trim(),
          address: String(metrics?.address || scenario.address || "").trim(),
          leaseType: String(metrics?.lease_type || "NNN").trim() || "NNN",
          rsf: Math.max(0, Number(metrics?.rsf || scenario.rsf || 0)),
          commencementDate: String(metrics?.commencement_date || scenario.commencement || "").trim(),
          expirationDate: String(metrics?.expiration_date || scenario.expiration || "").trim(),
          termMonths: Math.max(0, Math.floor(Number(result.term_months || 0))),
          totalObligation: Number(result.total_cost_nominal || 0),
          npvCost: Number(result.npv_cost || 0),
          avgCostPsfYear: Number(result.avg_cost_psf_year || 0),
          equalizedAvgCostPsfYear: Number(equalized?.averageCostPsfYear || 0),
        };
      });
      const equalizedWindow = equalizedUi.windowStart && equalizedUi.windowEnd
        ? {
          start: equalizedUi.windowStart,
          end: equalizedUi.windowEnd,
          source: equalizedUi.windowSource || "overlap",
        }
        : null;
      const link = buildFinancialAnalysesShareLink(
        {
          scenarios: scenariosForShare,
          equalizedWindow,
        },
        {
          brokerageName: resolvedBrokerageName,
          clientName: meta.prepared_for || "Client",
          reportDate: meta.report_date || undefined,
          preparedBy: meta.prepared_by || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY,
        },
      );
      await navigator.clipboard.writeText(link);
      setShareLinkStatus("Share link copied.");
      setShareLinkError(null);
    } catch (err) {
      setShareLinkError(getDisplayErrorMessage(err));
      setShareLinkStatus(null);
    }
  }, [
    includedScenarios,
    buildReportMeta,
    authSession,
    organizationBranding,
    getScenarioResultForExport,
    canonicalComputeCache,
    equalizedUi,
    defaultPreparedByFromAuth,
  ]);

  const engineResults = useMemo(() => {
    const included = includedScenarios;
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
          return canonicalResponseToEngineResult(cached, s.id, displayName, s);
        }
        // Fallback to local engine while canonical compute is loading/recomputing.
        return runMonthlyEngine(scenarioToCanonical(s), globalDiscountRate);
      });
    }
    return included.map((s) => runMonthlyEngine(scenarioToCanonical(s), globalDiscountRate));
  }, [includedScenarios, globalDiscountRate, isProduction, canonicalComputeCache]);

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
  const coverMetaPreview = buildReportMeta();
  const heroSparklineValues = useMemo(() => {
    const values = chartData
      .map((row) => Number(row.npv_cost))
      .filter((v) => Number.isFinite(v) && v > 0)
      .slice(0, 8);
    if (values.length >= 2) return values;
    return [780000, 820000, 760000, 805000, 790000];
  }, [chartData]);
  const heroSparklinePoints = useMemo(() => {
    const min = Math.min(...heroSparklineValues);
    const max = Math.max(...heroSparklineValues);
    const span = Math.max(1, max - min);
    const count = heroSparklineValues.length;
    return heroSparklineValues
      .map((value, idx) => {
        const x = count === 1 ? 12 : 12 + (idx * 236) / (count - 1);
        const y = 58 - ((value - min) / span) * 42;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [heroSparklineValues]);
  const showHomeHero = rawModuleParam.length === 0;
  const topNavOffsetClass = "pt-24 sm:pt-28";
  const moduleHasDedicatedTopTabs = Boolean(authSession) && activePlatformModule === DEFAULT_PLATFORM_MODULE_ID;
  const mainTopOffsetClass = !showHomeHero && !moduleHasDedicatedTopTabs ? topNavOffsetClass : "";
  const tabTopOffsetClass = !showHomeHero ? topNavOffsetClass : "mt-8";

  if (Boolean(authSession) && !activeClient) {
    return (
      <main className={`relative z-10 app-container ${topNavOffsetClass} pb-14 md:pb-20`}>
        <section className="scroll-mt-24 bg-grid mt-6">
          <div className="mx-auto w-full max-w-6xl">
            <ClientWorkspaceGate />
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      {showHomeHero ? (
        <>
          <section className="relative z-10 section-shell pt-28 sm:pt-32 bg-grid">
            <div className="app-container">
              <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] border border-white/25">
                <div className="p-6 sm:p-8 lg:p-12 border-b xl:border-b-0 xl:border-r border-white/25">
                  <p className="heading-kicker mb-4">Platform</p>
                  <h1 className="heading-display max-w-3xl">
                    The Commercial Real Estate Model
                  </h1>

                  <p className="body-lead mt-6 max-w-xl">
                    Transform any lease into a structured, branded financial analysis in minutes.
                    Built for brokerages, investment firms, and enterprise real estate teams.
                  </p>

                  <div className="flex gap-3 sm:gap-4 mt-8 flex-wrap">
                    <Link
                      href="/example"
                      className="btn-premium btn-premium-primary w-full sm:w-auto px-8"
                    >
                      View Example Report
                    </Link>

                    <Link
                      href="/?module=financial-analyses#extract"
                      className="btn-premium btn-premium-secondary w-full sm:w-auto px-8"
                    >
                      Try It Live
                    </Link>
                  </div>
                </div>
                <div className="p-4 sm:p-6 lg:p-8 bg-white/[0.01] flex">
                  <div className="border border-white/25 bg-black/65 p-2 sm:p-3 flex-1 min-h-[280px]">
                    <div className="grid grid-cols-12 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 h-full">
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.18)" }}>
                        <p className="heading-kicker mb-1">Scenarios</p>
                        <p className="text-3xl sm:text-4xl tracking-tight text-white leading-none">{Math.max(1, scenarios.length)}</p>
                      </div>
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.12)" }}>
                        <p className="heading-kicker mb-1">Status</p>
                        <p className="text-lg text-white/90 leading-tight">{(exportExcelLoading || exportPdfLoading) ? "Running" : "Ready"}</p>
                      </div>
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.08)" }}>
                        <p className="heading-kicker mb-1">Brokerage</p>
                        <p className="text-sm text-white/90 leading-tight truncate">{brokerageName || CRE_DEFAULT_BROKERAGE_NAME}</p>
                      </div>

                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.1)" }}>
                        <p className="heading-kicker mb-1">Prepared for</p>
                        <p className="text-sm text-white/90 leading-tight truncate">{coverMetaPreview.prepared_for || "Client"}</p>
                      </div>
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.07)" }}>
                        <p className="heading-kicker mb-1">Prepared by</p>
                        <p className="text-sm text-white/90 leading-tight truncate">{coverMetaPreview.prepared_by || CRE_DEFAULT_PREPARED_BY}</p>
                      </div>
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-center" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.05)" }}>
                        <p className="heading-kicker mb-1">Report date</p>
                        <p className="text-sm text-white/90 leading-tight">{coverMetaPreview.report_date}</p>
                      </div>

                      <div className="col-span-8 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col justify-between min-h-[132px]" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.05)" }}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="heading-kicker">NPV trend</p>
                          <p className="text-[11px] uppercase tracking-[0.12em] text-white/70">live profile</p>
                        </div>
                        <svg viewBox="0 0 260 70" className="w-full h-20 sm:h-24">
                          <polyline
                            points={heroSparklinePoints}
                            fill="none"
                            stroke="rgba(255,255,255,0.28)"
                            strokeWidth="5"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                          <polyline
                            points={heroSparklinePoints}
                            fill="none"
                            stroke="rgba(255,255,255,0.9)"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </svg>
                      </div>
                      <div className="col-span-4 border border-white/20 px-3 py-2.5 hero-parallax-layer flex flex-col" style={{ ["--parallax-y" as string]: "calc(var(--hero-scroll-y, 0px) * -0.03)" }}>
                        <p className="heading-kicker mb-2">Document pipeline</p>
                        <div className="grid grid-cols-1 gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/80 h-full content-center">
                          <span className="border border-white/20 px-2 py-1 text-center">Upload</span>
                          <span className="border border-white/20 px-2 py-1 text-center">Extract</span>
                          <span className="border border-white/20 px-2 py-1 text-center">Compare</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <FeatureTiles />
        </>
      ) : null}

      {!showHomeHero && moduleHasDedicatedTopTabs ? (
        <section className={`relative z-10 app-container ${tabTopOffsetClass}`}>
          <div className="mx-auto w-full max-w-6xl">
            <PlatformModuleTabs
              tabs={FINANCIAL_ANALYSES_TOOL_TABS}
              activeId={activeTopTab}
              onChange={(id) => {
                if (isFinancialAnalysesToolId(id)) setActiveTopTab(id);
              }}
              dense
            />
          </div>
        </section>
      ) : null}

      {!showHomeHero ? (() => {
        if (activePlatformModule === "financial-analyses") {
          return activeTopTab === "lease-comparison" ? (
      <main className={`relative z-10 app-container ${mainTopOffsetClass} pb-14 md:pb-20`}>
        <ClientDocumentCenter />
        <section id="extract" className="scroll-mt-24 bg-grid">
        <div className="mx-auto w-full max-w-6xl space-y-6 border border-white/15 p-3 sm:p-4 bg-grid">
          <div id="upload-section" className="border border-white/15 bg-black/25 p-4 sm:p-5">
            <div className="mx-auto w-full max-w-[760px] text-center">
              <h2 className="heading-section mb-3">Upload and Extract</h2>
              <ExtractUpload
                showAdvancedOptions={showDiagnostics}
                onSuccess={(data, context) =>
                  handleNormalizeSuccess(data, {
                    name: context?.fileName,
                    file: context?.file,
                    sourceModule: "financial-analyses",
                  })
                }
                onError={handleExtractError}
              />
              {activeClient ? (
                <div className="mt-3 text-left">
                  <ClientDocumentPicker
                    buttonLabel="Select Existing Client Document"
                    allowedTypes={["leases", "amendments", "proposals", "lois", "counters", "redlines", "sublease documents", "other"]}
                    onSelectDocument={handleExistingDocumentSelection}
                  />
                </div>
              ) : null}
              {extractError && (
                <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                  {extractError}
                </div>
              )}
              {showDiagnostics && (
                <div className="mt-4 text-left">
                  <Diagnostics />
                </div>
              )}
            </div>
          </div>

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
          onChangeLeaseObligationMode={changeScenarioObligationMode}
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
          <h2 className="heading-section mb-2">COMPUTE AND REPORT</h2>
          <p className="text-sm text-slate-300 mb-4">
            Export Excel or PDF directly from your current scenarios. Analysis refresh is optional.
          </p>
          <p className="text-sm text-slate-300 mb-4">
            Uses per-scenario discount rate overrides when set; otherwise defaults to 8%.
          </p>
          {!authSession && (
            <div className="mb-5 border border-white/20 bg-slate-950/50 p-4 text-sm text-slate-200">
              <p className="mb-3">Sign in or create an account to save brokerage branding and export PDF reports.</p>
              <div className="flex flex-wrap gap-2">
                <a href="/account?mode=signin" className="btn-premium btn-premium-secondary">
                  Sign in
                </a>
                <a href="/account?mode=signup" className="btn-premium btn-premium-primary">
                  Create account
                </a>
              </div>
            </div>
          )}
          <div className="mb-5 border border-slate-300/20 bg-slate-950/30 p-4">
            <p className="heading-kicker mb-2">Brokerage branding</p>
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
              <div>
                <p className="text-xs text-slate-400">Brokerage name</p>
                <p className="mt-1 text-sm text-white">{brokerageName || "The CRE Model"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Brokerage logo: {organizationBranding?.has_logo ? "Saved" : "Using The CRE Model default"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Brokerage name and logo are editable only in Account.
                </p>
              </div>
              {authSession ? (
                <a href="/branding" className="btn-premium btn-premium-secondary w-full sm:w-auto text-center">
                  Manage brokerage branding
                </a>
              ) : (
                <a href="/account?mode=signin" className="btn-premium btn-premium-secondary w-full sm:w-auto text-center">
                  Sign in to manage branding
                </a>
              )}
            </div>
            {brandingLoading && <p className="mt-2 text-xs text-slate-500">Loading brokerage branding…</p>}
          </div>
          <div className="mb-5 border-t border-slate-300/20 pt-4">
            <p className="heading-kicker mb-2">Report meta (for PDF cover)</p>
            <div className="mb-3">
              <ClientLogoUploader
                logoDataUrl={clientLogoDataUrl}
                fileName={clientLogoFileName}
                uploading={clientLogoUploading}
                disabled={!authSession}
                disabledMessage="Sign in to upload a client logo."
                error={clientLogoError}
                onUpload={uploadClientLogo}
                onClear={clearClientLogo}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-slate-400">Prepared for</span>
                <input
                  type="text"
                  value={reportMeta.prepared_for}
                  onChange={(e) => setReportMeta((prev) => ({ ...prev, prepared_for: e.target.value }))}
                  className="input-premium mt-1 disabled:opacity-60"
                  placeholder="Client"
                  disabled={!authSession}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Prepared by</span>
                <input
                  type="text"
                  value={reportMeta.prepared_by}
                  onChange={(e) => setReportMeta((prev) => ({ ...prev, prepared_by: e.target.value }))}
                  className="input-premium mt-1 disabled:opacity-60"
                  placeholder={CRE_DEFAULT_PREPARED_BY}
                  disabled={!authSession}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Report date</span>
                <input
                  type="text"
                  value={reportMeta.report_date}
                  onChange={(e) => setReportMeta((prev) => ({ ...prev, report_date: e.target.value }))}
                  onBlur={(e) =>
                    setReportMeta((prev) => ({
                      ...prev,
                      report_date: normalizeDateMmDdYyyy(e.target.value),
                    }))
                  }
                  className="input-premium mt-1 disabled:opacity-60"
                  placeholder="MM.DD.YYYY"
                  disabled={!authSession}
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Market</span>
                <input
                  type="text"
                  value={reportMeta.market}
                  onChange={(e) => setReportMeta((prev) => ({ ...prev, market: e.target.value }))}
                  className="input-premium mt-1 disabled:opacity-60"
                  placeholder={inferredReportLocation.market || "Auto from document/API"}
                  disabled={!authSession}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs text-slate-400">Submarket</span>
                <input
                  type="text"
                  value={reportMeta.submarket}
                  onChange={(e) => setReportMeta((prev) => ({ ...prev, submarket: e.target.value }))}
                  className="input-premium mt-1 disabled:opacity-60"
                  placeholder={inferredReportLocation.submarket || "Auto from document/API when available"}
                  disabled={!authSession}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Defaults if blank: Prepared for = Client, Prepared by = The CRE Model, Report date = today (MM.DD.YYYY). Market/Submarket use API extracted values when available.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportExcelDeck}
                disabled={exportExcelLoading || scenarios.length === 0 || !authSession}
                className="btn-premium btn-premium-success w-full sm:w-auto disabled:opacity-50"
              >
                {exportExcelLoading ? "Exporting…" : "Export Excel"}
              </button>
              <button
                type="button"
                onClick={exportPdfDeck}
                disabled={exportPdfLoading || scenarios.length === 0 || !authSession}
                className="btn-premium btn-premium-secondary w-full sm:w-auto disabled:opacity-50"
              >
                {exportPdfLoading ? "Exporting…" : "Export PDF deck"}
              </button>
              <button
                type="button"
                onClick={() => { void copyFinancialAnalysisShareLink(); }}
                disabled={includedScenarios.length === 0}
                className="btn-premium btn-premium-secondary w-full sm:w-auto disabled:opacity-50"
              >
                Copy Share Link
              </button>
          </div>
          {shareLinkStatus ? <p className="mt-2 text-sm text-cyan-200">{shareLinkStatus}</p> : null}
          {(exportPdfError || exportExcelError || shareLinkError) && (
            <p className="mt-2 text-sm text-red-300">{exportPdfError || exportExcelError || shareLinkError}</p>
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
                {equalizedUi.needsCustomWindow && (
                  <div className="mb-4 border border-amber-500/40 bg-amber-500/10 p-4">
                    <p className="text-sm font-medium text-amber-200">
                      {equalizedUi.message || "No overlapping lease term for equalized comparison."}
                    </p>
                    <p className="text-xs text-amber-100/80 mt-1">
                      Enter a custom equalized comparison period (MM.DD.YYYY) to compute equalized metrics.
                    </p>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs text-amber-100/80">Custom start</span>
                        <input
                          type="text"
                          value={equalizedCustomWindow.start}
                          onChange={(e) =>
                            setEqualizedCustomWindow((prev) => ({ ...prev, start: e.target.value }))
                          }
                          onBlur={(e) =>
                            setEqualizedCustomWindow((prev) => ({
                              ...prev,
                              start: normalizeDateMmDdYyyy(e.target.value) || e.target.value.trim(),
                            }))
                          }
                          className="input-premium mt-1"
                          placeholder="MM.DD.YYYY"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs text-amber-100/80">Custom end</span>
                        <input
                          type="text"
                          value={equalizedCustomWindow.end}
                          onChange={(e) =>
                            setEqualizedCustomWindow((prev) => ({ ...prev, end: e.target.value }))
                          }
                          onBlur={(e) =>
                            setEqualizedCustomWindow((prev) => ({
                              ...prev,
                              end: normalizeDateMmDdYyyy(e.target.value) || e.target.value.trim(),
                            }))
                          }
                          className="input-premium mt-1"
                          placeholder="MM.DD.YYYY"
                        />
                      </label>
                    </div>
                  </div>
                )}
                <SummaryMatrix
                  results={engineResults}
                  equalized={equalizedUi}
                  scenariosById={scenariosById}
                  onUpdateTiBudgetPsf={updateScenarioTiBudgetPsf}
                />
                <AnalyticsWorkbench
                  results={engineResults}
                  canonicalByScenarioId={canonicalComputeCache}
                  onCustomChartsChange={setCustomChartsForExport}
                />
              </>
            )}
              </ResultsActionsCard>
        </div>
        </section>
      </main>
      ) : (
        <main className={`relative z-10 app-container ${mainTopOffsetClass} pb-14 md:pb-20`}>
          <ClientDocumentCenter />
          <section className="scroll-mt-24 bg-grid mt-6 space-y-4">
            <div className="mx-auto w-full max-w-6xl space-y-4">
              {!authSession && (
                <div className="border border-white/20 bg-slate-950/50 p-4 text-sm text-slate-200">
                  <p className="mb-3">Sign in or create an account to save brokerage branding and export PDF reports.</p>
                  <div className="flex flex-wrap gap-2">
                    <a href="/account?mode=signin" className="btn-premium btn-premium-secondary">
                      Sign in
                    </a>
                    <a href="/account?mode=signup" className="btn-premium btn-premium-primary">
                      Create account
                    </a>
                  </div>
                </div>
              )}
              <div className="border border-white/20 bg-slate-950/35 p-4 space-y-4">
                <div className="border border-slate-300/20 bg-slate-950/30 p-4">
                  <p className="heading-kicker mb-2">Brokerage branding</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                    <div>
                      <p className="text-xs text-slate-400">Brokerage name</p>
                      <p className="mt-1 text-sm text-white">{brokerageName || "The CRE Model"}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        Brokerage logo: {organizationBranding?.has_logo ? "Saved" : "Using The CRE Model default"}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        Brokerage name and logo are editable only in Account.
                      </p>
                    </div>
                    {authSession ? (
                      <a href="/branding" className="btn-premium btn-premium-secondary w-full sm:w-auto text-center">
                        Manage brokerage branding
                      </a>
                    ) : (
                      <a href="/account?mode=signin" className="btn-premium btn-premium-secondary w-full sm:w-auto text-center">
                        Sign in to manage branding
                      </a>
                    )}
                  </div>
                  {brandingLoading && <p className="mt-2 text-xs text-slate-500">Loading brokerage branding…</p>}
                </div>

                <div className="border-t border-slate-300/20 pt-4">
                  <p className="heading-kicker mb-2">Report meta (for PDF cover)</p>
                  <div className="mb-3">
                    <ClientLogoUploader
                      logoDataUrl={clientLogoDataUrl}
                      fileName={clientLogoFileName}
                      uploading={clientLogoUploading}
                      disabled={!authSession}
                      disabledMessage="Sign in to upload a client logo."
                      error={clientLogoError}
                      onUpload={uploadClientLogo}
                      onClear={clearClientLogo}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs text-slate-400">Prepared for</span>
                      <input
                        type="text"
                        value={reportMeta.prepared_for}
                        onChange={(e) => setReportMeta((prev) => ({ ...prev, prepared_for: e.target.value }))}
                        className="input-premium mt-1 disabled:opacity-60"
                        placeholder="Client"
                        disabled={!authSession}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-400">Prepared by</span>
                      <input
                        type="text"
                        value={reportMeta.prepared_by}
                        onChange={(e) => setReportMeta((prev) => ({ ...prev, prepared_by: e.target.value }))}
                        className="input-premium mt-1 disabled:opacity-60"
                        placeholder={CRE_DEFAULT_PREPARED_BY}
                        disabled={!authSession}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs text-slate-400">Report date</span>
                      <input
                        type="text"
                        value={reportMeta.report_date}
                        onChange={(e) => setReportMeta((prev) => ({ ...prev, report_date: e.target.value }))}
                        onBlur={(e) =>
                          setReportMeta((prev) => ({
                            ...prev,
                            report_date: normalizeDateMmDdYyyy(e.target.value),
                          }))
                        }
                        className="input-premium mt-1 disabled:opacity-60"
                        placeholder="MM.DD.YYYY"
                        disabled={!authSession}
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Defaults if blank: Prepared for = Client, Prepared by = The CRE Model, Report date = today (MM.DD.YYYY).
                  </p>
                </div>
              </div>
            </div>

            <SubleaseRecoveryAnalysis
              clientId={workspaceScopeId}
              sourceScenario={selectedScenario ?? scenarios[0] ?? null}
              exportBranding={{
                brokerageName: authSession
                  ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
                  : CRE_DEFAULT_BROKERAGE_NAME,
                clientName: reportMeta.prepared_for.trim() || "Client",
                reportDate: normalizeDateMmDdYyyy(reportMeta.report_date) || formatDateMmDdYyyy(new Date()),
                preparedBy: reportMeta.prepared_by.trim() || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY,
                brokerageLogoDataUrl: authSession
                  ? (
                    organizationBranding?.logo_data_url
                    || (organizationBranding?.logo_asset_bytes
                      ? `data:${organizationBranding.logo_content_type || "image/png"};base64,${organizationBranding.logo_asset_bytes}`
                      : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`)
                  )
                  : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`,
                clientLogoDataUrl: authSession ? clientLogoDataUrl : null,
              }}
            />
          </section>
        </main>
          );
        }
        if (activePlatformModule === "completed-leases") {
          return (
        <main className={`relative z-10 app-container ${mainTopOffsetClass} pb-14 md:pb-20`}>
          <ClientDocumentCenter showDropZone={false} />
          <CompletedLeasesWorkspace
            clientId={workspaceScopeId}
            exportBranding={{
              brokerageName: authSession
                ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
                : CRE_DEFAULT_BROKERAGE_NAME,
              clientName: reportMeta.prepared_for.trim() || "Client",
              reportDate: normalizeDateMmDdYyyy(reportMeta.report_date) || formatDateMmDdYyyy(new Date()),
              preparedBy: reportMeta.prepared_by.trim() || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY,
              brokerageLogoDataUrl: authSession
                ? (
                  organizationBranding?.logo_data_url
                  || (organizationBranding?.logo_asset_bytes
                    ? `data:${organizationBranding.logo_content_type || "image/png"};base64,${organizationBranding.logo_asset_bytes}`
                    : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`)
                )
                : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`,
              clientLogoDataUrl: authSession ? clientLogoDataUrl : null,
            }}
          />
        </main>
          );
        }
        if (activePlatformModule === "surveys") {
          return (
        <main className={`relative z-10 app-container ${mainTopOffsetClass} pb-14 md:pb-20`}>
          <ClientDocumentCenter />
          <SurveysWorkspace
            clientId={workspaceScopeId}
            exportBranding={{
              brokerageName: authSession
                ? ((organizationBranding?.brokerage_name || "").trim() || CRE_DEFAULT_BROKERAGE_NAME)
                : CRE_DEFAULT_BROKERAGE_NAME,
              clientName: reportMeta.prepared_for.trim() || "Client",
              reportDate: normalizeDateMmDdYyyy(reportMeta.report_date) || formatDateMmDdYyyy(new Date()),
              preparedBy: reportMeta.prepared_by.trim() || defaultPreparedByFromAuth || CRE_DEFAULT_PREPARED_BY,
              brokerageLogoDataUrl: authSession
                ? (
                  organizationBranding?.logo_data_url
                  || (organizationBranding?.logo_asset_bytes
                    ? `data:${organizationBranding.logo_content_type || "image/png"};base64,${organizationBranding.logo_asset_bytes}`
                    : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`)
                )
                : `${typeof window !== "undefined" ? window.location.origin : ""}${CRE_DEFAULT_LOGO_PUBLIC_PATH}`,
              clientLogoDataUrl: authSession ? clientLogoDataUrl : null,
            }}
          />
        </main>
          );
        }
        return (
          <main className={`relative z-10 app-container ${mainTopOffsetClass} pb-14 md:pb-20`}>
            <ClientDocumentCenter />
            <ObligationsWorkspace clientId={workspaceScopeId} clientName={activeClient?.name || null} />
          </main>
        );
      })() : null}
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="relative z-10 app-container pt-24 sm:pt-28 pb-14 md:pb-20" />}>
      <HomeContent />
    </Suspense>
  );
}
