import { describe, expect, it } from "vitest";
import type { CanonicalComputeResponse, ScenarioWithId } from "@/lib/types";
import { canonicalResponseToEngineResult } from "@/lib/canonical-api";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: overrides.id ?? "scenario-1",
    name: overrides.name ?? "Scenario 1",
    building_name: overrides.building_name ?? "Test Building",
    suite: overrides.suite ?? "100",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 10000,
    commencement: overrides.commencement ?? "2026-01-01",
    expiration: overrides.expiration ?? "2026-12-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 11, rate_psf_yr: 36 }],
    free_rent_months: overrides.free_rent_months ?? 2,
    free_rent_start_month: overrides.free_rent_start_month ?? 0,
    free_rent_end_month: overrides.free_rent_end_month ?? 1,
    free_rent_abatement_type: overrides.free_rent_abatement_type ?? "gross",
    abatement_periods: overrides.abatement_periods ?? [
      { start_month: 0, end_month: 1, abatement_type: "gross" },
    ],
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_allowance_source_of_truth: overrides.ti_allowance_source_of_truth ?? "psf",
    ti_budget_total: overrides.ti_budget_total ?? 0,
    ti_source_of_truth: overrides.ti_source_of_truth ?? "psf",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 12,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 12,
    opex_growth: overrides.opex_growth ?? 0,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 0,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    document_type_detected: overrides.document_type_detected ?? "lease",
  };
}

function makeCanonicalResponse(): CanonicalComputeResponse {
  return {
    normalized_canonical_lease: {
      rsf: 10000,
      lease_type: "NNN",
      commencement_date: "2026-01-01",
      expiration_date: "2026-12-31",
      term_months: 12,
      free_rent_months: 2,
      free_rent_scope: "base",
      free_rent_periods: [{ start_month: 0, end_month: 1, scope: "base" }],
      discount_rate_annual: 0.08,
      rent_schedule: [{ start_month: 0, end_month: 11, rent_psf_annual: 36 }],
      opex_psf_year_1: 12,
      opex_growth_rate: 0,
      expense_structure_type: "nnn",
      parking_count: 0,
      parking_rate_monthly: 0,
      ti_allowance_psf: 0,
      ti_budget_total: 0,
      notes: "",
      building_name: "Test Building",
      suite: "100",
      floor: "",
      premises_name: "Test Building Suite 100",
      scenario_name: "Scenario 1",
      scenario_id: "scenario-1",
      address: "",
    },
    monthly_rows: [],
    annual_rows: [],
    metrics: {
      premises_name: "Test Building Suite 100",
      rsf: 10000,
      lease_type: "NNN",
      term_months: 12,
      commencement_date: "2026-01-01",
      expiration_date: "2026-12-31",
      base_rent_total: 300000,
      base_rent_avg_psf_year: 30,
      opex_total: 100000,
      opex_avg_psf_year: 10,
      parking_total: 0,
      parking_avg_psf_year: 0,
      ti_value_total: 0,
      // Stale backend value for base-only abatement: should be overridden from source scenario.
      free_rent_value_total: 60000,
      total_obligation_nominal: 340000,
      npv_cost: 320000,
      equalized_avg_cost_psf_year: 34,
      avg_all_in_cost_psf_year: 34,
      discount_rate_annual: 0.08,
      notes: "",
      building_name: "Test Building",
      suite: "100",
      floor: "",
      address: "",
    },
    warnings: [],
    assumptions: [],
  };
}

describe("canonicalResponseToEngineResult", () => {
  it("uses source scenario abatement scope and amount when provided", () => {
    const sourceScenario = makeScenario();
    const result = canonicalResponseToEngineResult(
      makeCanonicalResponse(),
      sourceScenario.id,
      sourceScenario.name,
      sourceScenario
    );

    // Gross abatement for 2 months at 10k RSF:
    // base: (36/12)*10000*2 = 60,000
    // opex: (12/12)*10000*2 = 20,000
    // total = 80,000
    expect(result.metrics.abatementAmount).toBeCloseTo(80000, 2);
    expect(result.metrics.abatementType).toContain("Gross rent");
    expect(result.metrics.abatementAppliedWhen).toBe("M1-M2");
  });
});

