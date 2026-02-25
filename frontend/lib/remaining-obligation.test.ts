import { describe, expect, it } from "vitest";
import type { ScenarioInput } from "@/lib/types";
import {
  applyLeaseModelChoice,
  firstDayOfNextMonthLocal,
} from "@/lib/remaining-obligation";

function makeScenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    name: overrides.name ?? "Benbrook Suite 200",
    building_name: overrides.building_name ?? "Benbrook",
    suite: overrides.suite ?? "200",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 4626,
    commencement: overrides.commencement ?? "2026-12-01",
    expiration: overrides.expiration ?? "2034-03-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 87, rate_psf_yr: 26 }],
    free_rent_months: overrides.free_rent_months ?? 8,
    free_rent_start_month: overrides.free_rent_start_month ?? 0,
    free_rent_end_month: overrides.free_rent_end_month ?? 7,
    free_rent_abatement_type: overrides.free_rent_abatement_type ?? "base",
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_allowance_source_of_truth: overrides.ti_allowance_source_of_truth ?? "psf",
    ti_budget_total: overrides.ti_budget_total ?? 0,
    ti_source_of_truth: overrides.ti_source_of_truth ?? "psf",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 14.3,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 14.3,
    opex_growth: overrides.opex_growth ?? 0.03,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 19,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    one_time_costs: overrides.one_time_costs,
    broker_fee: overrides.broker_fee,
    security_deposit_months: overrides.security_deposit_months,
  };
}

describe("remaining-obligation date boundaries", () => {
  it("computes next-month start correctly at month end", () => {
    expect(firstDayOfNextMonthLocal(new Date(2026, 1, 28))).toBe("2026-03-01");
  });

  it("computes next-month start correctly at year end", () => {
    expect(firstDayOfNextMonthLocal(new Date(2026, 11, 31))).toBe("2027-01-01");
  });

  it("shifts commenced lease to remaining window and excludes pre-start one-time costs", () => {
    const source = makeScenario({
      commencement: "2026-01-31",
      expiration: "2030-01-31",
      one_time_costs: [
        { name: "Before remaining", amount: 1000, month: 1 }, // 2026-02-28
        { name: "At/after remaining", amount: 2000, month: 2 }, // 2026-03-31
      ],
      ti_allowance_psf: 5,
      ti_budget_total: 10_000,
      broker_fee: 25_000,
      security_deposit_months: 1,
    });

    const modeled = applyLeaseModelChoice(source, "remaining_obligation", new Date(2026, 1, 28));
    expect(modeled.is_remaining_obligation).toBe(true);
    expect(modeled.remaining_obligation_start_date).toBe("2026-03-01");
    expect(modeled.commencement).toBe("2026-03-01");
    expect(modeled.expiration).toBe("2030-01-31");
    expect(modeled.name).toBe("Benbrook Remaining Obligation");
    expect(modeled.one_time_costs).toEqual([{ name: "At/after remaining", amount: 2000, month: 0 }]);
    expect(modeled.ti_allowance_psf).toBe(0);
    expect(modeled.ti_budget_total).toBe(0);
    expect(modeled.broker_fee).toBe(0);
    expect(modeled.security_deposit_months).toBe(0);
  });

  it("restores full original term from in-memory snapshot without re-upload", () => {
    const source = makeScenario({
      commencement: "2026-11-30",
      expiration: "2034-03-31",
      rent_steps: [
        { start: 0, end: 11, rate_psf_yr: 26 },
        { start: 12, end: 23, rate_psf_yr: 26.78 },
      ],
      abatement_periods: [{ start_month: 0, end_month: 7, abatement_type: "base" }],
    });
    const remaining = applyLeaseModelChoice(source, "remaining_obligation", new Date(2026, 11, 31));
    const restored = applyLeaseModelChoice(remaining, "full_original_term", new Date(2026, 11, 31));

    expect(remaining.commencement).toBe("2027-01-01");
    expect(restored.commencement).toBe("2026-11-30");
    expect(restored.expiration).toBe("2034-03-31");
    expect(restored.rent_steps).toEqual(source.rent_steps);
    expect(restored.abatement_periods).toEqual(source.abatement_periods);
    expect(restored.is_remaining_obligation).toBe(false);
  });
});
