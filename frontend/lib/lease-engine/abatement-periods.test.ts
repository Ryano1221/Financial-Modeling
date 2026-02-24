import { describe, expect, it } from "vitest";
import type { ScenarioWithId } from "@/lib/types";
import { scenarioToCanonical, runMonthlyEngine } from "@/lib/lease-engine";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: overrides.id ?? "abatement-1",
    name: overrides.name ?? "Abatement Test",
    building_name: overrides.building_name ?? "Test Building",
    suite: overrides.suite ?? "100",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 10000,
    commencement: overrides.commencement ?? "2026-01-01",
    expiration: overrides.expiration ?? "2026-12-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 11, rate_psf_yr: 36 }],
    free_rent_months: overrides.free_rent_months ?? 0,
    free_rent_start_month: overrides.free_rent_start_month,
    free_rent_end_month: overrides.free_rent_end_month,
    free_rent_abatement_type: overrides.free_rent_abatement_type,
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_budget_total: overrides.ti_budget_total,
    ti_source_of_truth: overrides.ti_source_of_truth,
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 12,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 12,
    opex_growth: overrides.opex_growth ?? 0,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 10,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 100,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
  };
}

describe("scenario abatement periods", () => {
  it("keeps full month count for end-of-month expirations", () => {
    const eastbound = makeScenario({
      commencement: "2026-05-01",
      expiration: "2030-08-31",
      rent_steps: [
        { start: 0, end: 11, rate_psf_yr: 42 },
        { start: 12, end: 23, rate_psf_yr: 43.26 },
        { start: 24, end: 35, rate_psf_yr: 44.56 },
        { start: 36, end: 47, rate_psf_yr: 45.90 },
        { start: 48, end: 51, rate_psf_yr: 47.28 },
      ],
    });
    const eastlake = makeScenario({
      commencement: "2026-06-01",
      expiration: "2030-05-31",
      rent_steps: [
        { start: 0, end: 11, rate_psf_yr: 38 },
        { start: 12, end: 23, rate_psf_yr: 39.14 },
        { start: 24, end: 35, rate_psf_yr: 40.31 },
        { start: 36, end: 47, rate_psf_yr: 41.52 },
      ],
    });

    const eastboundCanonical = scenarioToCanonical(eastbound);
    const eastlakeCanonical = scenarioToCanonical(eastlake);

    expect(eastboundCanonical.datesAndTerm.leaseTermMonths).toBe(52);
    expect(eastlakeCanonical.datesAndTerm.leaseTermMonths).toBe(48);
  });

  it("supports multiple non-contiguous base abatements", () => {
    const scenario = makeScenario({
      abatement_periods: [
        { start_month: 0, end_month: 1, abatement_type: "base" },
        { start_month: 6, end_month: 6, abatement_type: "base" },
      ],
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    expect(result.monthly[0].baseRent).toBe(0);
    expect(result.monthly[1].baseRent).toBe(0);
    expect(result.monthly[6].baseRent).toBe(0);
    // Base-only abatement should not zero OpEx/parking.
    expect(result.monthly[0].opex).toBeGreaterThan(0);
    expect(result.monthly[6].parking).toBeGreaterThan(0);
  });

  it("zeros base and opex for gross abatements, with parking unaffected unless separately abated", () => {
    const scenario = makeScenario({
      abatement_periods: [{ start_month: 3, end_month: 4, abatement_type: "gross" }],
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    expect(result.monthly[3].baseRent).toBe(0);
    expect(result.monthly[3].opex).toBe(0);
    expect(result.monthly[3].parking).toBeGreaterThan(0);

    expect(result.monthly[4].baseRent).toBe(0);
    expect(result.monthly[4].opex).toBe(0);
    expect(result.monthly[4].parking).toBeGreaterThan(0);

    // Outside the abatement window should remain priced.
    expect(result.monthly[2].baseRent).toBeGreaterThan(0);
    expect(result.monthly[5].opex).toBeGreaterThan(0);
  });

  it("zeros parking when parking abatement periods are set", () => {
    const scenario = makeScenario({
      abatement_periods: [{ start_month: 3, end_month: 4, abatement_type: "gross" }],
      parking_abatement_periods: [{ start_month: 4, end_month: 5 }],
    });
    const result = runMonthlyEngine(scenarioToCanonical(scenario), 0.08);

    expect(result.monthly[3].parking).toBeGreaterThan(0);
    expect(result.monthly[4].parking).toBe(0);
    expect(result.monthly[5].parking).toBe(0);
    expect(result.monthly[6].parking).toBeGreaterThan(0);
  });
});
