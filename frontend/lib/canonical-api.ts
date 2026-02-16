/**
 * Backend canonical lease: types and conversion to/from ScenarioInput.
 * Single source of truth for /normalize and /compute-canonical.
 */

import type { ScenarioInput, CanonicalComputeResponse, CanonicalMetrics } from "@/lib/types";
import type { BackendCanonicalLease, BackendRentScheduleStep } from "@/lib/types";
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

/** Build display premises_name from building_name + suite when both exist. */
export function buildPremisesName(buildingName?: string | null, suite?: string | null): string {
  const b = (buildingName ?? "").trim();
  const su = (suite ?? "").trim();
  if (b && su) return `${b} Suite ${su}`;
  return su || b || "";
}

/** Display order: Building name, Suite, Street address (for any Address or Premises display). */
export function formatBuildingSuiteAddress(c: {
  building_name?: string | null;
  suite?: string | null;
  address?: string | null;
}): string {
  const b = (c.building_name ?? "").trim();
  const su = (c.suite ?? "").trim();
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
  const premisesName = s.name;
  return {
    scenario_id: scenarioId ?? "",
    scenario_name: scenarioName ?? s.name,
    premises_name: premisesName,
    address: (s.address ?? "").trim(),
    building_name: "",
    suite: "",
    floor: (s.floor ?? "").trim(),
    rsf: s.rsf,
    lease_type: "NNN",
    commencement_date: s.commencement,
    expiration_date: s.expiration,
    term_months: termMonths,
    free_rent_months: s.free_rent_months ?? 0,
    discount_rate_annual: s.discount_rate_annual ?? 0.08,
    rent_schedule: (s.rent_steps ?? []).map((step) => ({
      start_month: step.start,
      end_month: step.end,
      rent_psf_annual: step.rate_psf_yr,
    })),
    opex_psf_year_1: s.base_opex_psf_yr ?? 0,
    opex_growth_rate: s.opex_growth ?? 0,
    expense_stop_psf: s.base_year_opex_psf_yr ?? 0,
    expense_structure_type: s.opex_mode === "base_year" ? "base_year" : "nnn" as const,
    parking_count: s.parking_spaces ?? 0,
    parking_rate_monthly: s.parking_cost_monthly_per_space ?? 0,
    ti_allowance_psf: s.ti_allowance_psf ?? 0,
    notes: "",
  };
}

/** Convert backend CanonicalLease to ScenarioInput for form and list. */
export function backendCanonicalToScenarioInput(
  c: BackendCanonicalLease,
  name?: string
): ScenarioInput {
  const rentSteps: { start: number; end: number; rate_psf_yr: number }[] = (
    c.rent_schedule ?? []
  ).map((step: BackendRentScheduleStep) => ({
    start: step.start_month,
    end: step.end_month,
    rate_psf_yr: step.rent_psf_annual,
  }));
  const opexMode = c.expense_structure_type === "base_year" ? "base_year" : "nnn";
  const buildingName = (c.building_name ?? "").trim();
  const suite = (c.suite ?? "").trim();
  const combinedName = buildPremisesName(buildingName || undefined, suite || undefined) || c.premises_name || c.scenario_name;
  return {
    name: name ?? c.scenario_name ?? (combinedName || "Option"),
    building_name: buildingName || undefined,
    suite: suite || undefined,
    floor: (c.floor ?? "").trim() || undefined,
    address: (c.address ?? "").trim() || undefined,
    rsf: c.rsf,
    commencement: c.commencement_date,
    expiration: c.expiration_date,
    rent_steps: rentSteps.length > 0 ? rentSteps : [{ start: 0, end: Math.max(0, (c.term_months ?? 0) - 1), rate_psf_yr: 0 }],
    free_rent_months: typeof c.free_rent_months === "number" ? c.free_rent_months : 0,
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
    premisesName: formatBuildingSuiteAddress({ building_name: m.building_name, suite: m.suite, address: m.address }) || m.premises_name || "",
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
