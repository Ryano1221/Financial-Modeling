import { describe, expect, it } from "vitest";
import type { ScenarioWithId } from "@/lib/types";
import { computeEqualizedComparison } from "@/lib/equalized";
import { runMonthlyEngine, scenarioToCanonical } from "@/lib/lease-engine";

function makeScenario(overrides: Partial<ScenarioWithId>): ScenarioWithId {
  return {
    id: overrides.id ?? "scenario-1",
    name: overrides.name ?? "Scenario",
    rsf: overrides.rsf ?? 10000,
    commencement: overrides.commencement ?? "2026-01-01",
    expiration: overrides.expiration ?? "2026-12-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 11, rate_psf_yr: 24 }],
    free_rent_months: overrides.free_rent_months ?? 0,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_budget_total: overrides.ti_budget_total ?? 0,
    ti_allowance_source_of_truth: overrides.ti_allowance_source_of_truth ?? "psf",
    ti_source_of_truth: overrides.ti_source_of_truth ?? "total",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 10,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 10,
    opex_by_calendar_year: overrides.opex_by_calendar_year,
    opex_growth: overrides.opex_growth ?? 0.03,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 0,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    notes: overrides.notes ?? "",
    building_name: overrides.building_name ?? "",
    suite: overrides.suite ?? "",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    document_type_detected: overrides.document_type_detected,
    phase_in_steps: overrides.phase_in_steps,
    free_rent_start_month: overrides.free_rent_start_month,
    free_rent_end_month: overrides.free_rent_end_month,
    free_rent_abatement_type: overrides.free_rent_abatement_type,
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
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

describe("computeEqualizedComparison", () => {
  it("uses overlap max commencement and min expiration", () => {
    const a = makeScenario({ id: "a", commencement: "2026-01-01", expiration: "2026-12-31" });
    const b = makeScenario({ id: "b", commencement: "2026-03-01", expiration: "2026-10-31" });
    const result = computeEqualizedComparison([a, b], 0.08, null);

    expect(result.needsCustomWindow).toBe(false);
    expect(result.windowStart).toBe("2026-03-01");
    expect(result.windowEnd).toBe("2026-10-31");
    expect(result.metricsByScenario.a).toBeDefined();
    expect(result.metricsByScenario.b).toBeDefined();
  });

  it("requires custom dates when no overlap exists", () => {
    const a = makeScenario({ id: "a", commencement: "2026-01-01", expiration: "2026-03-31" });
    const b = makeScenario({ id: "b", commencement: "2026-06-01", expiration: "2026-12-31" });
    const result = computeEqualizedComparison([a, b], 0.08, null);

    expect(result.needsCustomWindow).toBe(true);
    expect(result.message.toLowerCase()).toContain("no overlapping lease term");
  });

  it("computes from custom window and differs from full-term totals", () => {
    const a = makeScenario({ id: "a", commencement: "2026-01-01", expiration: "2027-12-31" });
    const b = makeScenario({ id: "b", commencement: "2028-01-01", expiration: "2028-12-31" });

    const custom = computeEqualizedComparison(
      [a, b],
      0.08,
      { start: "2026-02-01", end: "2026-06-30" }
    );

    expect(custom.needsCustomWindow).toBe(false);
    expect(custom.windowSource).toBe("custom");
    expect(custom.windowStart).toBe("2026-02-01");
    expect(custom.windowEnd).toBe("2026-06-30");

    const fullA = runMonthlyEngine(scenarioToCanonical(a), 0.08);
    expect(custom.metricsByScenario.a.totalCost).toBeLessThan(fullA.metrics.totalObligation);
    expect(custom.metricsByScenario.a.npvCost).toBeGreaterThan(0);
  });

  it("excludes abatement from equalized gross-rent metrics", () => {
    const scenario = makeScenario({
      id: "gross-abatement",
      rsf: 12000,
      commencement: "2026-01-01",
      expiration: "2026-12-31",
      rent_steps: [{ start: 0, end: 11, rate_psf_yr: 24 }],
      abatement_periods: [{ start_month: 0, end_month: 1, abatement_type: "gross" }],
      free_rent_months: 2,
      free_rent_abatement_type: "gross",
      base_opex_psf_yr: 0,
      opex_growth: 0,
    });
    const result = computeEqualizedComparison([scenario], 0.08, null);
    expect(result.needsCustomWindow).toBe(false);
    const canonical = scenarioToCanonical(scenario);
    const abated = runMonthlyEngine(canonical, 0.08);
    const noAbatement = runMonthlyEngine(
      {
        ...canonical,
        rentSchedule: {
          ...canonical.rentSchedule,
          abatement: undefined,
          abatements: undefined,
        },
      },
      0.08
    );
    const resultAvgGross = result.metricsByScenario["gross-abatement"].averageGrossRentMonth;
    const expectedNoAbatementAvg =
      noAbatement.monthly.reduce((sum, row) => sum + row.baseRent, 0) /
      Math.max(1, result.windowMonthCount);
    const expectedAbatedAvg =
      abated.monthly.reduce((sum, row) => sum + row.baseRent, 0) /
      Math.max(1, result.windowMonthCount);

    // Gross-rent metrics should use the no-abatement series.
    expect(resultAvgGross).toBeCloseTo(expectedNoAbatementAvg, 2);
    expect(resultAvgGross).toBeGreaterThan(expectedAbatedAvg);
  });

  it("keeps equalized avg-cost metrics consistent with equalized total cost", () => {
    const scenario = makeScenario({
      id: "consistency",
      rsf: 5900,
      commencement: "2026-06-01",
      expiration: "2030-05-31",
      rent_steps: [
        { start: 1, end: 12, rate_psf_yr: 38 },
        { start: 13, end: 24, rate_psf_yr: 39.14 },
        { start: 25, end: 36, rate_psf_yr: 40.31 },
        { start: 37, end: 48, rate_psf_yr: 41.52 },
      ],
      one_time_costs: [{ month: 6, amount: 25000, label: "Landlord-required work" }],
      base_opex_psf_yr: 10,
      opex_growth: 0.03,
    });

    const result = computeEqualizedComparison([scenario], 0.08, null);
    expect(result.needsCustomWindow).toBe(false);
    const metrics = result.metricsByScenario.consistency;

    expect(metrics.averageCostMonth).toBeCloseTo(
      metrics.totalCost / Math.max(1, result.windowMonthCount),
      2
    );
    expect(metrics.averageCostYear).toBeCloseTo(metrics.averageCostMonth * 12, 2);
    expect(metrics.averageCostPsfYear).toBeCloseTo(
      (metrics.averageCostMonth * 12) / scenario.rsf,
      2
    );
    expect(metrics.averageCostPsfYear).toBeCloseTo(
      metrics.totalCost / (scenario.rsf * Math.max(1e-9, result.windowMonthCount / 12)),
      2
    );
  });

  it("includes TI budget and TI allowance effects in equalized totals", () => {
    const base = makeScenario({
      id: "ti-base",
      rsf: 10000,
      commencement: "2026-01-01",
      expiration: "2026-12-31",
      ti_allowance_psf: 0,
      ti_budget_total: 0,
    });
    const withTi = makeScenario({
      id: "ti-with",
      rsf: 10000,
      commencement: "2026-01-01",
      expiration: "2026-12-31",
      ti_allowance_psf: 2, // $20,000 allowance
      ti_budget_total: 5_000, // net -$15,000 credit at month 0
    });

    const result = computeEqualizedComparison([base, withTi], 0.08, null);
    const baseTotal = result.metricsByScenario["ti-base"].totalCost;
    const withTiTotal = result.metricsByScenario["ti-with"].totalCost;
    expect(withTiTotal).toBeCloseTo(baseTotal - 15000, 2);
  });

});
