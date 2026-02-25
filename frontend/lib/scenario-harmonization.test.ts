import { describe, expect, it } from "vitest";
import type { ScenarioWithId } from "@/lib/types";
import { harmonizeExtractedScenarios } from "@/lib/scenario-harmonization";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: overrides.id ?? "s1",
    name: overrides.name ?? "Scenario",
    document_type_detected: overrides.document_type_detected ?? "unknown",
    building_name: overrides.building_name ?? "",
    suite: overrides.suite ?? "",
    floor: overrides.floor ?? "",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 1000,
    commencement: overrides.commencement ?? "2026-01-01",
    expiration: overrides.expiration ?? "2031-01-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 59, rate_psf_yr: 20 }],
    free_rent_months: overrides.free_rent_months ?? 0,
    free_rent_start_month: overrides.free_rent_start_month ?? 0,
    free_rent_end_month: overrides.free_rent_end_month ?? 0,
    free_rent_abatement_type: overrides.free_rent_abatement_type ?? "base",
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 0,
    ti_allowance_source_of_truth: overrides.ti_allowance_source_of_truth ?? "psf",
    ti_budget_total: overrides.ti_budget_total ?? 0,
    ti_source_of_truth: overrides.ti_source_of_truth ?? "psf",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 10,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 10,
    opex_by_calendar_year: overrides.opex_by_calendar_year,
    opex_growth: overrides.opex_growth ?? 0.03,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 0,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 0,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    one_time_costs: overrides.one_time_costs,
    broker_fee: overrides.broker_fee,
    security_deposit_months: overrides.security_deposit_months,
    is_remaining_obligation: overrides.is_remaining_obligation,
    remaining_obligation_start_date: overrides.remaining_obligation_start_date,
    original_extracted_lease: overrides.original_extracted_lease,
  };
}

describe("scenario harmonization", () => {
  it("backfills suite and placeholder opex for commenced extracted scenarios from peers", () => {
    const remaining = makeScenario({
      id: "remaining",
      name: "Vista Ridge Remaining Obligation",
      building_name: "Vista Ridge",
      suite: "",
      commencement: "2026-03-01",
      expiration: "2026-11-30",
      rsf: 10081,
      base_opex_psf_yr: 10,
      base_year_opex_psf_yr: 10,
      is_remaining_obligation: true,
      original_extracted_lease: {
        name: "Original",
        commencement: "2019-09-01",
        expiration: "2026-11-30",
        rent_steps: [{ start: 0, end: 86, rate_psf_yr: 21.5 }],
        free_rent_months: 0,
        ti_allowance_psf: 0,
      },
    });
    const proposal = makeScenario({
      id: "proposal",
      name: "Vista Ridge Suite 450",
      building_name: "Vista Ridge",
      suite: "450",
      commencement: "2026-12-01",
      expiration: "2032-02-29",
      rsf: 5944,
      base_opex_psf_yr: 14.5,
      base_year_opex_psf_yr: 14.5,
      original_extracted_lease: {
        name: "Proposal",
        commencement: "2026-12-01",
        expiration: "2032-02-29",
        rent_steps: [{ start: 0, end: 62, rate_psf_yr: 27 }],
        free_rent_months: 3,
        ti_allowance_psf: 25,
      },
    });

    const out = harmonizeExtractedScenarios([remaining, proposal], new Date(2026, 1, 25));
    const harmonizedRemaining = out.find((s) => s.id === "remaining");
    expect(harmonizedRemaining?.suite).toBe("450");
    expect(harmonizedRemaining?.base_opex_psf_yr).toBe(14.5);
    expect(harmonizedRemaining?.base_year_opex_psf_yr).toBe(14.5);
  });

  it("does not backfill future commencements", () => {
    const future = makeScenario({
      id: "future",
      building_name: "Vista Ridge",
      suite: "",
      commencement: "2027-01-01",
      base_opex_psf_yr: 10,
      base_year_opex_psf_yr: 10,
      original_extracted_lease: {
        name: "Future",
        commencement: "2027-01-01",
        expiration: "2031-01-31",
        rent_steps: [{ start: 0, end: 47, rate_psf_yr: 25 }],
        free_rent_months: 0,
        ti_allowance_psf: 0,
      },
    });
    const peer = makeScenario({
      id: "peer",
      building_name: "Vista Ridge",
      suite: "450",
      base_opex_psf_yr: 14.5,
      base_year_opex_psf_yr: 14.5,
    });
    const out = harmonizeExtractedScenarios([future, peer], new Date(2026, 1, 25));
    const harmonized = out.find((s) => s.id === "future");
    expect(harmonized?.suite).toBe("");
    expect(harmonized?.base_opex_psf_yr).toBe(10);
  });
});

