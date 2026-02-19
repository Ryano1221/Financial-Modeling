/**
 * Backend canonical lease: types and conversion to/from ScenarioInput.
 * Single source of truth for /normalize and /compute-canonical.
 */

import type { ScenarioInput, CanonicalComputeResponse, CanonicalMetrics } from "@/lib/types";
import type { BackendCanonicalLease, BackendRentScheduleStep, BackendPhaseInStep } from "@/lib/types";
import type { EngineResult, OptionMetrics } from "@/lib/lease-engine/monthly-engine";

function monthDiff(comm: string, exp: string): number {
  const [cy, cm, cd] = comm.split("-").map(Number);
  const [ey, em, ed] = exp.split("-").map(Number);
  let m = (ey - cy) * 12 + (em - cm);
  if (ed < cd) m -= 1;
  return Math.max(0, m);
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
  const freeStart = Math.max(0, Math.floor(Number(s.free_rent_start_month ?? 0) || 0));
  const fallbackEndFromMonths = Math.max(freeStart, freeStart + Math.max(0, Math.floor(Number(s.free_rent_months ?? 0) || 0)) - 1);
  const freeEnd = Math.max(
    freeStart,
    Math.floor(Number(s.free_rent_end_month ?? fallbackEndFromMonths) || fallbackEndFromMonths)
  );
  const hasFreeRange = Number.isFinite(freeStart) && Number.isFinite(freeEnd) && freeEnd >= freeStart;
  const freeRentMonths = hasFreeRange ? (freeEnd - freeStart + 1) : Math.max(0, Math.floor(Number(s.free_rent_months ?? 0) || 0));
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
    lease_type: "NNN",
    commencement_date: s.commencement,
    expiration_date: s.expiration,
    term_months: termMonths,
    free_rent_months: freeRentMonths,
    free_rent_scope: s.free_rent_abatement_type ?? "base",
    free_rent_periods:
      freeRentMonths > 0
        ? [
            {
              start_month: freeStart,
              end_month: freeEnd,
            },
          ]
        : [],
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
    expense_structure_type: s.opex_mode === "base_year" ? "base_year" : "nnn" as const,
    parking_count: s.parking_spaces ?? 0,
    parking_rate_monthly: s.parking_cost_monthly_per_space ?? 0,
    ti_allowance_psf: s.ti_allowance_psf ?? 0,
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
  const period = freePeriods.length > 0 ? freePeriods[0] : null;
  const fallbackMonths = typeof c.free_rent_months === "number" ? c.free_rent_months : 0;
  const freeStart = period ? Math.max(0, Number(period.start_month) || 0) : 0;
  const freeEnd = period ? Math.max(freeStart, Number(period.end_month) || freeStart) : Math.max(0, fallbackMonths - 1);
  const computedMonths = period ? Math.max(0, freeEnd - freeStart + 1) : Math.max(0, fallbackMonths);
  const opexMode = c.expense_structure_type === "base_year" ? "base_year" : "nnn";
  const displayName = name ?? c.scenario_name ?? c.premises_name ?? "Option";
  return {
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
    free_rent_abatement_type: c.free_rent_scope === "gross" ? "gross" : "base",
    ti_allowance_psf: c.ti_allowance_psf ?? 0,
    opex_mode: opexMode,
    base_opex_psf_yr: c.opex_psf_year_1 ?? 0,
    base_year_opex_psf_yr: c.expense_stop_psf ?? c.opex_psf_year_1 ?? 0,
    opex_growth: c.opex_growth_rate ?? 0,
    discount_rate_annual: c.discount_rate_annual ?? 0.08,
    parking_spaces: c.parking_count ?? 0,
    parking_cost_monthly_per_space: c.parking_rate_monthly ?? 0,
  };
}

/** Map backend CanonicalComputeResponse to frontend EngineResult for SummaryMatrix/charts. */
export function canonicalResponseToEngineResult(
  res: CanonicalComputeResponse,
  scenarioId: string,
  scenarioName: string
): EngineResult {
  const m = res.metrics;
  const termMonths = m.term_months ?? 0;
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
    escalationPercent: 0,
    opexPsfYr: m.opex_avg_psf_year ?? 0,
    opexEscalationPercent: 0,
    parkingCostAnnual: m.parking_total ?? 0,
    tiBudget: m.ti_value_total ?? 0,
    tiAllowance: m.ti_value_total ?? 0,
    tiOutOfPocket: 0,
    grossTiOutOfPocket: 0,
    avgGrossRentPerMonth: (m.base_rent_total ?? 0) / 12,
    avgGrossRentPerYear: m.base_rent_total ?? 0,
    avgAllInCostPerMonth: (m.total_obligation_nominal ?? 0) / Math.max(1, termMonths),
    avgAllInCostPerYear: (m.total_obligation_nominal ?? 0) / (termMonths / 12 || 1),
    avgCostPsfYr: m.avg_all_in_cost_psf_year ?? 0,
    npvAtDiscount: m.npv_cost ?? 0,
    discountRateUsed: m.discount_rate_annual ?? 0.08,
    totalObligation: m.total_obligation_nominal ?? 0,
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
