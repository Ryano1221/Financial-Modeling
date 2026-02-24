/**
 * Backend canonical lease: types and conversion to/from ScenarioInput.
 * Single source of truth for /normalize and /compute-canonical.
 */

import type { ScenarioInput, CanonicalComputeResponse, CanonicalMetrics } from "@/lib/types";
import type { BackendCanonicalLease, BackendRentScheduleStep, BackendPhaseInStep } from "@/lib/types";
import { runMonthlyEngine, type EngineResult, type OptionMetrics } from "@/lib/lease-engine/monthly-engine";
import { scenarioToCanonical } from "@/lib/lease-engine/convert-from-api";
import {
  effectiveTiAllowancePsf,
  effectiveTiBudgetTotal,
  normalizeTiSourceOfTruth,
  syncTiFields,
} from "@/lib/ti";
import { inferRentEscalationPercentFromSteps } from "@/lib/rent-escalation";

function toNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function monthDiff(comm: string, exp: string): number {
  const [cy, cm, cd] = comm.split("-").map(Number);
  const [ey, em, ed] = exp.split("-").map(Number);
  let m = (ey - cy) * 12 + (em - cm);
  if (ed < cd) m -= 1;
  return Math.max(0, m);
}

function formatAbatementTypeFromPeriods(
  periods: Array<{ scope?: string | null }>
): string {
  if (periods.length === 0) return "None";
  const scopes = Array.from(
    new Set(periods.map((period) => (period.scope === "gross" ? "gross" : "base")))
  );
  if (scopes.length === 1) return scopes[0] === "gross" ? "Gross rent (Full)" : "Base rent (Full)";
  return "Mixed base/gross (Full)";
}

function formatAbatementAppliedFromPeriods(
  periods: Array<{ start_month: number; end_month: number }>
): string {
  if (periods.length === 0) return "—";
  return periods
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0)) + 1;
      const end = Math.max(start, Math.floor(Number(period.end_month) || (start - 1)) + 1);
      return start === end ? `M${start}` : `M${start}-M${end}`;
    })
    .join(", ");
}

function normalizeSourceAbatementPeriods(
  source?: ScenarioInput
): Array<{ start_month: number; end_month: number; scope: "base" | "gross" }> {
  if (!source) return [];
  const explicit = (source.abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month) || start));
      return {
        start_month: start,
        end_month: end,
        scope: period.abatement_type === "gross" ? "gross" as const : "base" as const,
      };
    })
    .filter((period) => period.end_month >= period.start_month);
  if (explicit.length > 0) return explicit;

  const fallbackMonths = Math.max(0, Math.floor(Number(source.free_rent_months ?? 0) || 0));
  if (fallbackMonths <= 0) return [];
  const fallbackStart = Math.max(0, Math.floor(Number(source.free_rent_start_month ?? 0) || 0));
  const fallbackEnd = Math.max(
    fallbackStart,
    Math.floor(Number(source.free_rent_end_month ?? (fallbackStart + fallbackMonths - 1)) || (fallbackStart + fallbackMonths - 1))
  );
  return [
    {
      start_month: fallbackStart,
      end_month: fallbackEnd,
      scope: source.free_rent_abatement_type === "gross" ? "gross" : "base",
    },
  ];
}

export const LEASE_TYPE_ENUM = [
  "NNN",
  "Gross",
  "Modified Gross",
  "Absolute NNN",
  "Full Service",
] as const;

export type LeaseTypeEnum = (typeof LEASE_TYPE_ENUM)[number];

export function getSuiteOrFloor(suite?: string | null, floor?: string | null): string {
  const su = (suite ?? "").trim();
  if (su) return su;
  return (floor ?? "").trim();
}

export function getSuiteOrFloorDisplay(suite?: string | null, floor?: string | null): string {
  const su = (suite ?? "").trim();
  if (su) return su;
  const fl = (floor ?? "").trim();
  return fl ? `Floor ${fl}` : "";
}

export function normalizeLeaseType(
  input?: string | null
): "NNN" | "Gross" | "Modified Gross" | "Absolute NNN" | "Full Service" {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return "NNN";
  if (s === "nnn") return "NNN";
  if (s === "gross") return "Gross";
  if (s === "modified gross" || s === "modified_gross" || s === "mod gross" || s === "modified") return "Modified Gross";
  if (s === "absolute nnn" || s === "absolute_nnn" || s === "abs nnn") return "Absolute NNN";
  if (s === "full service" || s === "full_service" || s === "fs") return "Full Service";
  if (s === "full-service") return "Full Service";
  if (s === "absolute-nnn") return "Absolute NNN";
  return "NNN";
}

/** Build display premises_name from building_name + suite (or floor fallback). */
export function buildPremisesName(buildingName?: string | null, suite?: string | null, floor?: string | null): string {
  const b = (buildingName ?? "").trim();
  const su = (suite ?? "").trim();
  const fl = (floor ?? "").trim();
  if (b && su) return `${b} Suite ${su}`;
  if (b && fl) return `${b} Floor ${fl}`;
  if (su) return su;
  if (fl) return `Floor ${fl}`;
  return b || "";
}

/**
 * Single display name for premises everywhere (cards, summary, export).
 * If suite exists, use "{building_name} Suite {suite}".
 * If suite is missing and floor exists, use "{building_name} Floor {floor}".
 * Else if premises_name exists → premises_name.
 * Else → scenario name (fallback).
 */
export function getPremisesDisplayName(opts: {
  building_name?: string | null;
  suite?: string | null;
  floor?: string | null;
  premises_name?: string | null;
  scenario_name?: string | null;
}): string {
  const b = (opts.building_name ?? "").trim();
  const su = (opts.suite ?? "").trim();
  const fl = (opts.floor ?? "").trim();
  if (b && su) return `${b} Suite ${su}`.trim();
  if (b && fl) return `${b} Floor ${fl}`.trim();
  if (su) return su;
  if (fl) return `Floor ${fl}`;
  if (b) return b;
  const p = (opts.premises_name ?? "").trim();
  if (p) return p;
  return (opts.scenario_name ?? "").trim() || "Option";
}

/** Display order: Building name, Suite/floor fallback, Street address (for any Address or Premises display). */
export function formatBuildingSuiteAddress(c: {
  building_name?: string | null;
  suite?: string | null;
  floor?: string | null;
  address?: string | null;
}): string {
  const b = (c.building_name ?? "").trim();
  const su = getSuiteOrFloorDisplay(c.suite, c.floor);
  const a = (c.address ?? "").trim();
  const parts = [b, su, a].filter(Boolean);
  return parts.join(" · ") || "";
}

/** Convert form scenario to backend CanonicalLease for POST /compute-canonical. */
export function scenarioInputToBackendCanonical(
  s: ScenarioInput,
  scenarioId?: string,
  scenarioName?: string
): BackendCanonicalLease {
  const termMonths = monthDiff(s.commencement, s.expiration);
  const suite = (s.suite ?? "").trim();
  const normalizedAbatementPeriods = (s.abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month) || start));
      return {
        start_month: start,
        end_month: end,
        scope: period.abatement_type === "gross" ? "gross" as const : "base" as const,
      };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const normalizedParkingAbatementPeriods = (s.parking_abatement_periods ?? [])
    .map((period) => {
      const start = Math.max(0, Math.floor(Number(period.start_month) || 0));
      const end = Math.max(start, Math.floor(Number(period.end_month) || start));
      return { start_month: start, end_month: end };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const fallbackFreeStart = Math.max(0, Math.floor(Number(s.free_rent_start_month ?? 0) || 0));
  const fallbackEndFromMonths = Math.max(
    fallbackFreeStart,
    fallbackFreeStart + Math.max(0, Math.floor(Number(s.free_rent_months ?? 0) || 0)) - 1
  );
  const fallbackFreeEnd = Math.max(
    fallbackFreeStart,
    Math.floor(Number(s.free_rent_end_month ?? fallbackEndFromMonths) || fallbackEndFromMonths)
  );
  const effectiveAbatementPeriods = normalizedAbatementPeriods.length > 0
    ? normalizedAbatementPeriods
    : ((Math.max(0, Math.floor(Number(s.free_rent_months ?? 0) || 0)) > 0)
        ? [
            {
              start_month: fallbackFreeStart,
              end_month: fallbackFreeEnd,
              scope: s.free_rent_abatement_type === "gross" ? "gross" as const : "base" as const,
            },
          ]
        : []);
  const firstAbatement = effectiveAbatementPeriods[0];
  const freeStart = firstAbatement?.start_month ?? fallbackFreeStart;
  const freeEnd = firstAbatement?.end_month ?? fallbackFreeEnd;
  const freeRentMonths = effectiveAbatementPeriods.length > 0
    ? effectiveAbatementPeriods.reduce((sum, p) => sum + Math.max(0, p.end_month - p.start_month + 1), 0)
    : Math.max(0, Math.floor(Number(s.free_rent_months ?? 0) || 0));
  const backendLeaseType: LeaseTypeEnum =
    s.opex_mode === "full_service"
      ? "Full Service"
      : s.opex_mode === "base_year"
        ? "Modified Gross"
        : "NNN";
  const backendExpenseStructureType =
    s.opex_mode === "base_year" ? "base_year" : "nnn";
  const tiAllowancePsf = effectiveTiAllowancePsf(s);
  const tiBudgetTotal = effectiveTiBudgetTotal(s);
  const tiSource = normalizeTiSourceOfTruth(s.ti_source_of_truth, "psf");
  return {
    scenario_id: scenarioId ?? "",
    scenario_name: scenarioName ?? s.name,
    document_type_detected: s.document_type_detected ?? "",
    premises_name: buildPremisesName(s.building_name, s.suite, s.floor) || s.name,
    address: s.address ?? "",
    building_name: s.building_name ?? "",
    suite,
    floor: s.floor ?? "",
    rsf: s.rsf,
    lease_type: backendLeaseType,
    commencement_date: s.commencement,
    expiration_date: s.expiration,
    term_months: termMonths,
    free_rent_months: freeRentMonths,
    free_rent_scope: firstAbatement?.scope ?? (s.free_rent_abatement_type ?? "base"),
    free_rent_periods: effectiveAbatementPeriods,
    parking_abatement_periods: normalizedParkingAbatementPeriods,
    discount_rate_annual: s.discount_rate_annual ?? 0.08,
    rent_schedule: (s.rent_steps ?? []).map((step) => ({
      start_month: step.start,
      end_month: step.end,
      rent_psf_annual: step.rate_psf_yr,
    })),
    phase_in_schedule: (s.phase_in_steps ?? []).map((step) => ({
      start_month: step.start_month,
      end_month: step.end_month,
      rsf: step.rsf,
    })),
    opex_psf_year_1: s.base_opex_psf_yr ?? 0,
    opex_growth_rate: s.opex_growth ?? 0,
    expense_stop_psf: s.base_year_opex_psf_yr ?? 0,
    expense_structure_type: backendExpenseStructureType,
    parking_count: s.parking_spaces ?? 0,
    parking_rate_monthly: s.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: s.parking_sales_tax_rate ?? 0.0825,
    ti_allowance_psf: tiAllowancePsf,
    ti_budget_total: tiBudgetTotal,
    ti_source_of_truth: tiSource,
    notes: s.notes ?? "",
  };
}

/** Convert backend CanonicalLease to ScenarioInput for form and list. */
export function backendCanonicalToScenarioInput(
  c: BackendCanonicalLease,
  name?: string
): ScenarioInput {
  const suite = (c.suite ?? "").trim();
  const rentSteps: { start: number; end: number; rate_psf_yr: number }[] = (
    c.rent_schedule ?? []
  ).map((step: BackendRentScheduleStep) => ({
    start: step.start_month,
    end: step.end_month,
    rate_psf_yr: step.rent_psf_annual,
  }));
  const phaseInSteps: { start_month: number; end_month: number; rsf: number }[] = (
    c.phase_in_schedule ?? []
  ).map((step: BackendPhaseInStep) => ({
    start_month: step.start_month,
    end_month: step.end_month,
    rsf: step.rsf,
  }));
  const freePeriods = Array.isArray(c.free_rent_periods) ? c.free_rent_periods : [];
  const parkingPeriodsRaw = Array.isArray(c.parking_abatement_periods) ? c.parking_abatement_periods : [];
  const fallbackMonths = typeof c.free_rent_months === "number" ? c.free_rent_months : 0;
  const normalizedAbatementPeriods = freePeriods
    .map((period) => {
      const start = Math.max(0, Number(period.start_month) || 0);
      const end = Math.max(start, Number(period.end_month) || start);
      const scope = period.scope === "gross" ? "gross" : (c.free_rent_scope === "gross" ? "gross" : "base");
      return { start_month: start, end_month: end, abatement_type: scope as "base" | "gross" };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const fallbackStart = 0;
  const fallbackEnd = Math.max(0, fallbackMonths - 1);
  const fallbackAbatementPeriods =
    fallbackMonths > 0
      ? [
          {
            start_month: fallbackStart,
            end_month: fallbackEnd,
            abatement_type: c.free_rent_scope === "gross" ? "gross" as const : "base" as const,
          },
        ]
      : [];
  const effectiveAbatementPeriods = normalizedAbatementPeriods.length > 0 ? normalizedAbatementPeriods : fallbackAbatementPeriods;
  const parkingAbatementPeriods = parkingPeriodsRaw
    .map((period) => {
      const start = Math.max(0, Number(period.start_month) || 0);
      const end = Math.max(start, Number(period.end_month) || start);
      return { start_month: start, end_month: end };
    })
    .filter((period) => period.end_month >= period.start_month)
    .sort((a, b) => (a.start_month - b.start_month) || (a.end_month - b.end_month));
  const firstAbatement = effectiveAbatementPeriods[0];
  const freeStart = firstAbatement ? firstAbatement.start_month : 0;
  const freeEnd = firstAbatement ? firstAbatement.end_month : Math.max(0, fallbackMonths - 1);
  const computedMonths =
    effectiveAbatementPeriods.length > 0
      ? effectiveAbatementPeriods.reduce((sum, period) => sum + Math.max(0, period.end_month - period.start_month + 1), 0)
      : Math.max(0, fallbackMonths);
  const normalizedLeaseType = normalizeLeaseType(c.lease_type);
  const expenseType = String(c.expense_structure_type ?? "").toLowerCase();
  const opexMode =
    expenseType === "base_year" || expenseType === "gross_with_stop"
      ? "base_year"
      : (normalizedLeaseType === "Full Service" || normalizedLeaseType === "Gross" || normalizedLeaseType === "Modified Gross")
        ? "full_service"
        : "nnn";
  const displayName = name ?? c.scenario_name ?? c.premises_name ?? "Option";
  const scenario: ScenarioInput = {
    name: displayName,
    document_type_detected: (c.document_type_detected ?? "").toString().trim() || undefined,
    building_name: c.building_name ?? "",
    suite,
    floor: c.floor ?? "",
    address: c.address ?? "",
    notes: c.notes ?? "",
    rsf: c.rsf,
    commencement: c.commencement_date,
    expiration: c.expiration_date,
    rent_steps: rentSteps.length > 0 ? rentSteps : [{ start: 0, end: Math.max(0, (c.term_months ?? 0) - 1), rate_psf_yr: 0 }],
    phase_in_steps: phaseInSteps.length > 0 ? phaseInSteps : undefined,
    free_rent_months: computedMonths,
    free_rent_start_month: freeStart,
    free_rent_end_month: freeEnd,
    free_rent_abatement_type: firstAbatement?.abatement_type ?? (c.free_rent_scope === "gross" ? "gross" : "base"),
    abatement_periods: effectiveAbatementPeriods.length > 0 ? effectiveAbatementPeriods : undefined,
    parking_abatement_periods: parkingAbatementPeriods.length > 0 ? parkingAbatementPeriods : undefined,
    ti_allowance_psf: c.ti_allowance_psf ?? 0,
    ti_allowance_source_of_truth: "psf",
    ti_budget_total: typeof c.ti_budget_total === "number" ? c.ti_budget_total : undefined,
    ti_source_of_truth: normalizeTiSourceOfTruth(c.ti_source_of_truth, "psf"),
    opex_mode: opexMode,
    base_opex_psf_yr: c.opex_psf_year_1 ?? 0,
    base_year_opex_psf_yr: c.expense_stop_psf ?? c.opex_psf_year_1 ?? 0,
    opex_growth: c.opex_growth_rate ?? 0,
    discount_rate_annual: c.discount_rate_annual ?? 0.08,
    parking_spaces: c.parking_count ?? 0,
    parking_cost_monthly_per_space: c.parking_rate_monthly ?? 0,
    parking_sales_tax_rate: c.parking_sales_tax_rate ?? 0.0825,
  };
  return syncTiFields(scenario);
}

/** Map backend CanonicalComputeResponse to frontend EngineResult for SummaryMatrix/charts. */
export function canonicalResponseToEngineResult(
  res: CanonicalComputeResponse,
  scenarioId: string,
  scenarioName: string,
  scenarioSource?: ScenarioInput
): EngineResult {
  const m = res.metrics;
  const normalized = res.normalized_canonical_lease;
  const abatementPeriods = Array.isArray(normalized?.free_rent_periods)
    ? normalized.free_rent_periods
        .map((period) => ({
          start_month: Math.max(0, Math.floor(Number(period.start_month) || 0)),
          end_month: Math.max(0, Math.floor(Number(period.end_month) || 0)),
          scope: period.scope === "gross" ? "gross" : "base",
        }))
        .filter((period) => period.end_month >= period.start_month)
    : [];
  const fallbackMonths = Math.max(0, Math.floor(Number(normalized?.free_rent_months ?? 0) || 0));
  const backendAbatementPeriods = abatementPeriods.length > 0
    ? abatementPeriods
    : (
        fallbackMonths > 0
          ? [{
              start_month: 0,
              end_month: Math.max(0, fallbackMonths - 1),
              scope: normalized?.free_rent_scope === "gross" ? "gross" : "base",
            }]
          : []
      );
  const sourceAbatementPeriods = normalizeSourceAbatementPeriods(scenarioSource);
  const effectiveAbatementPeriods =
    sourceAbatementPeriods.length > 0 ? sourceAbatementPeriods : backendAbatementPeriods;
  const termMonths = m.term_months ?? 0;
  const sourceRsf = scenarioSource && Number.isFinite(Number(scenarioSource.rsf))
    ? Math.max(0, Number(scenarioSource.rsf))
    : 0;
  const rsfForTi = sourceRsf > 0 ? sourceRsf : Math.max(0, Number(m.rsf) || 0);
  const sourceTiSource = scenarioSource
    ? normalizeTiSourceOfTruth(scenarioSource.ti_source_of_truth, "psf")
    : "psf";
  const sourceTiBudgetTotal = scenarioSource ? effectiveTiBudgetTotal(scenarioSource) : null;
  const sourceTiAllowancePsf = scenarioSource ? effectiveTiAllowancePsf(scenarioSource) : null;
  const fallbackRsf = Math.max(0, Number(m.rsf) || 0);
  const tiBudgetPsf = (() => {
    if (sourceTiBudgetTotal != null && sourceRsf > 0) return sourceTiBudgetTotal / sourceRsf;
    if (sourceTiBudgetTotal != null && fallbackRsf > 0) return sourceTiBudgetTotal / fallbackRsf;
    return m.rsf && m.rsf > 0 ? toNumber(m.ti_value_total, 0) / m.rsf : 0;
  })();
  const tiAllowancePsf = (() => {
    if (sourceTiAllowancePsf != null) return sourceTiAllowancePsf;
    return toNumber(normalized?.ti_allowance_psf, 0) ||
      (m.rsf && m.rsf > 0 ? toNumber(m.ti_value_total, 0) / m.rsf : 0);
  })();
  const tiAllowanceTotal = rsfForTi > 0 ? tiAllowancePsf * rsfForTi : 0;
  const tiBudgetTotal = (() => {
    if (sourceTiBudgetTotal != null && sourceTiBudgetTotal > 0) return sourceTiBudgetTotal;
    if (sourceTiBudgetTotal != null && sourceTiSource === "total") return 0;
    const normalizedBudget = Math.max(
      0,
      toNumber((normalized as { ti_budget_total?: number } | undefined)?.ti_budget_total, 0)
    );
    if (normalizedBudget > 0) return normalizedBudget;
    const normalizedTiSource = normalizeTiSourceOfTruth(
      (normalized as { ti_source_of_truth?: unknown } | undefined)?.ti_source_of_truth,
      "psf"
    );
    if (normalizedTiSource === "total") return 0;
    return tiAllowanceTotal;
  })();
  const tiNetAtMonth0 = tiBudgetTotal - tiAllowanceTotal;
  const monthlyRows = Array.isArray(res.monthly_rows) ? res.monthly_rows : [];
  const monthZeroRow = monthlyRows.find((row) => Number(row.month_index) === 0);
  const inferredTiBudgetInBackendRows = (() => {
    if (!monthZeroRow) return 0;
    const components =
      toNumber(monthZeroRow.base_rent, 0) +
      toNumber(monthZeroRow.opex, 0) +
      toNumber(monthZeroRow.parking, 0) +
      toNumber(monthZeroRow.ti_amort, 0) +
      toNumber(monthZeroRow.concessions, 0);
    return Math.max(0, toNumber(monthZeroRow.total_cost, 0) - components);
  })();
  const monthlyTotalFromRows = monthlyRows.reduce(
    (sum, row) => sum + toNumber(row.total_cost, 0),
    0
  );
  const totalObligationWithTiBudget = (() => {
    const missingBudget = Math.max(0, tiBudgetTotal - inferredTiBudgetInBackendRows);
    return monthlyTotalFromRows + missingBudget;
  })();
  const totalObligationEffective = Math.max(
    toNumber(m.total_obligation_nominal, 0),
    totalObligationWithTiBudget
  );
  const parkingCount = Math.max(0, toNumber(normalized?.parking_count, 0));
  const parkingRateMonthly = Math.max(0, toNumber(normalized?.parking_rate_monthly, 0));
  const parkingSalesTaxRate = Math.max(0, toNumber(normalized?.parking_sales_tax_rate, 0.0825));
  const normalizedEscalationPercent =
    inferRentEscalationPercentFromSteps(
      (normalized?.rent_schedule ?? []).map((step) => ({
        start: step.start_month,
        end: step.end_month,
        rate_psf_yr: step.rent_psf_annual,
      }))
    ) * 100;
  const sourceEscalationPercent =
    scenarioSource?.rent_steps && scenarioSource.rent_steps.length > 0
      ? inferRentEscalationPercentFromSteps(
          scenarioSource.rent_steps.map((step) => ({
            start: step.start,
            end: step.end,
            rate_psf_yr: step.rate_psf_yr,
          }))
        ) * 100
      : 0;
  const effectiveEscalationPercent =
    normalizedEscalationPercent > 0
      ? normalizedEscalationPercent
      : (Number.isFinite(sourceEscalationPercent) ? sourceEscalationPercent : 0);
  const sourceAbatementAmount = (() => {
    if (!scenarioSource) return null;
    try {
      const scenarioCanonical = scenarioToCanonical({
        id: scenarioId,
        ...scenarioSource,
      });
      const computed = runMonthlyEngine(
        scenarioCanonical,
        Number.isFinite(Number(scenarioSource.discount_rate_annual))
          ? Number(scenarioSource.discount_rate_annual)
          : 0.08
      );
      return Math.max(0, toNumber(computed.metrics.abatementAmount, 0));
    } catch {
      return null;
    }
  })();
  const backendAbatementAmount = Math.max(0, toNumber(m.free_rent_value_total, 0));
  const effectiveAbatementAmount =
    sourceAbatementAmount != null ? sourceAbatementAmount : backendAbatementAmount;
  const metrics: OptionMetrics = {
    buildingName: m.building_name ?? "",
    suiteName: getSuiteOrFloorDisplay(m.suite, m.floor),
    premisesName: getPremisesDisplayName({
      building_name: m.building_name,
      suite: m.suite,
      floor: m.floor,
      premises_name: m.premises_name,
      scenario_name: scenarioName,
    }),
    rsf: m.rsf ?? 0,
    leaseType: m.lease_type ?? "",
    termMonths,
    commencementDate: m.commencement_date ?? "",
    expirationDate: m.expiration_date ?? "",
    baseRentPsfYr: m.base_rent_avg_psf_year ?? 0,
    escalationPercent: effectiveEscalationPercent,
    abatementAmount: effectiveAbatementAmount,
    abatementType: formatAbatementTypeFromPeriods(effectiveAbatementPeriods),
    abatementAppliedWhen: formatAbatementAppliedFromPeriods(effectiveAbatementPeriods),
    opexPsfYr: m.opex_avg_psf_year ?? 0,
    opexEscalationPercent: toNumber(normalized?.opex_growth_rate, 0),
    parkingCostPerSpotMonthlyPreTax: parkingRateMonthly,
    parkingCostPerSpotMonthly: parkingRateMonthly * (1 + parkingSalesTaxRate),
    parkingSalesTaxPercent: parkingSalesTaxRate,
    parkingCostAnnual: m.parking_total ?? 0,
    tiBudget: tiBudgetPsf,
    tiAllowance: tiAllowancePsf,
    tiOutOfPocket: Math.max(0, tiNetAtMonth0),
    grossTiOutOfPocket: tiBudgetTotal,
    avgGrossRentPerMonth: (m.base_rent_total ?? 0) / 12,
    avgGrossRentPerYear: m.base_rent_total ?? 0,
    avgAllInCostPerMonth: totalObligationEffective / Math.max(1, termMonths),
    avgAllInCostPerYear: totalObligationEffective / (termMonths / 12 || 1),
    avgCostPsfYr: m.avg_all_in_cost_psf_year ?? 0,
    npvAtDiscount: m.npv_cost ?? 0,
    discountRateUsed: m.discount_rate_annual ?? 0.08,
    totalObligation: totalObligationEffective,
    equalizedAvgCostPsfYr: m.equalized_avg_cost_psf_year ?? 0,
    notes: m.notes ?? "",
  };
  return {
    scenarioId,
    scenarioName,
    termMonths,
    monthly: [],
    annual: [],
    metrics,
    discountRateUsed: m.discount_rate_annual ?? 0.08,
  };
}
