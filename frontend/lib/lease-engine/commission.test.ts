import { describe, expect, it } from "vitest";

import type { ScenarioWithId } from "@/lib/types";
import { runMonthlyEngine, scenarioToCanonical } from "@/lib/lease-engine";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: overrides.id ?? "commission-1",
    name: overrides.name ?? "Commission Test",
    building_name: overrides.building_name ?? "Test Building",
    suite: overrides.suite ?? "100",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 10000,
    commencement: overrides.commencement ?? "2026-01-01",
    expiration: overrides.expiration ?? "2026-12-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 11, rate_psf_yr: 24 }],
    free_rent_months: overrides.free_rent_months ?? 0,
    free_rent_start_month: overrides.free_rent_start_month,
    free_rent_end_month: overrides.free_rent_end_month,
    free_rent_abatement_type: overrides.free_rent_abatement_type,
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_budget_total: overrides.ti_budget_total ?? 0,
    ti_source_of_truth: overrides.ti_source_of_truth ?? "total",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 10,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 10,
    opex_growth: overrides.opex_growth ?? 0.03,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    commission_rate: overrides.commission_rate ?? 0,
    commission_applies_to: overrides.commission_applies_to ?? "base_rent",
    parking_spaces: overrides.parking_spaces ?? 0,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    one_time_costs: overrides.one_time_costs,
    broker_fee: overrides.broker_fee,
    security_deposit_months: overrides.security_deposit_months,
    holdover_months: overrides.holdover_months,
    holdover_rent_multiplier: overrides.holdover_rent_multiplier,
    sublease_income_monthly: overrides.sublease_income_monthly,
    sublease_start_month: overrides.sublease_start_month,
    sublease_duration_months: overrides.sublease_duration_months,
  };
}

describe("commission calculations", () => {
  it("calculates commission on total base rent when basis is base rent", () => {
    const scenario = makeScenario({
      commission_rate: 0.05,
      commission_applies_to: "base_rent",
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    expect(result.metrics.commissionPercent).toBeCloseTo(5, 8);
    expect(result.metrics.commissionBasis).toBe("Total base rent");
    expect(result.metrics.commissionAmount).toBeCloseTo(12000, 6);
  });

  it("calculates gross-obligation commission using non-escalated opex", () => {
    const scenario = makeScenario({
      expiration: "2027-12-31",
      rent_steps: [{ start: 0, end: 23, rate_psf_yr: 24 }],
      base_opex_psf_yr: 10,
      opex_growth: 0.03,
      commission_rate: 0.10,
      commission_applies_to: "gross_obligation",
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    // Base rent total: 480,000; flat OpEx total: 200,000; commission @10% => 68,000.
    expect(result.metrics.commissionAmount).toBeCloseTo(68000, 6);
    expect(result.metrics.commissionBasis).toBe("Gross obligation");
  });

  it("treats whole-number commission input as percent points", () => {
    const scenario = makeScenario({
      commission_rate: 6,
      commission_applies_to: "base_rent",
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);
    expect(result.metrics.commissionPercent).toBeCloseTo(6, 8);
    expect(result.metrics.commissionAmount).toBeCloseTo(14400, 6);
  });

  it("computes NER as average base rate minus TI allowance, abatement, and commission (annualized $/SF)", () => {
    const scenario = makeScenario({
      rsf: 10000,
      expiration: "2026-12-31",
      rent_steps: [{ start: 0, end: 11, rate_psf_yr: 24 }],
      base_opex_psf_yr: 10,
      opex_growth: 0.03,
      ti_allowance_psf: 2,
      ti_budget_total: 0,
      abatement_periods: [{ start_month: 0, end_month: 0, abatement_type: "base" }],
      free_rent_months: 1,
      commission_rate: 0.06,
      commission_applies_to: "gross_obligation",
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    // Avg base rent = 24.00
    // TI allowance annualized = 2.00
    // Abatement annualized (1 month at $2/SF/month) = 2.00
    // Commission annualized uses commission base from modeled cash flow stream:
    // 6% * (base 220,000 + opex 100,000) / 10,000 = 1.92
    // NER = 24 - 2 - 2 - 1.92 = 18.08
    expect(result.metrics.netEffectiveRatePsfYr).toBeCloseTo(18.08, 6);
    expect(result.metrics.netEffectiveRatePsfYr).toBeLessThanOrEqual(result.metrics.baseRentPsfYr);
  });
});
