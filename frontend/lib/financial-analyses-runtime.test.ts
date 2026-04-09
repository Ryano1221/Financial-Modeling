import { describe, expect, it } from "vitest";

import {
  collectRenderableFinancialAnalysisScenarios,
  createEmptyEqualizedComparisonResult,
  validateScenarioForFinancialAnalysis,
} from "@/lib/financial-analyses-runtime";
import type { ScenarioWithId } from "@/lib/types";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: "scenario-1",
    name: "Test scenario",
    building_name: "Test Tower",
    suite: "100",
    floor: "",
    address: "100 Congress Ave, Austin, TX 78701",
    notes: "",
    rsf: 10000,
    commencement: "2027-01-01",
    expiration: "2032-12-31",
    rent_steps: [{ start: 0, end: 71, rate_psf_yr: 30 }],
    free_rent_months: 0,
    free_rent_start_month: 0,
    free_rent_end_month: 0,
    free_rent_abatement_type: "base",
    abatement_periods: [],
    parking_abatement_periods: [],
    ti_allowance_psf: 0,
    ti_allowance_source_of_truth: "psf",
    ti_budget_total: 0,
    ti_source_of_truth: "psf",
    opex_mode: "nnn",
    base_opex_psf_yr: 12,
    base_year_opex_psf_yr: 12,
    opex_growth: 0.03,
    discount_rate_annual: 0.08,
    commission_rate: 0.06,
    commission_applies_to: "gross_obligation",
    parking_spaces: 0,
    parking_cost_monthly_per_space: 0,
    parking_sales_tax_rate: 0.0825,
    ...overrides,
  };
}

describe("financial-analyses-runtime", () => {
  it("accepts a valid scenario", () => {
    const error = validateScenarioForFinancialAnalysis(makeScenario(), 0.08);
    expect(error).toBeNull();
  });

  it("rejects malformed scenarios instead of throwing", () => {
    const invalidScenario = makeScenario({
      rent_steps: undefined as unknown as ScenarioWithId["rent_steps"],
    });
    const error = validateScenarioForFinancialAnalysis(invalidScenario, 0.08);
    expect(error).toContain("could not be loaded into analysis");
  });

  it("collects only renderable scenarios", () => {
    const validScenario = makeScenario({ id: "valid", name: "Valid option" });
    const invalidScenario = makeScenario({
      id: "invalid",
      name: "Invalid option",
      rent_steps: undefined as unknown as ScenarioWithId["rent_steps"],
    });

    const collected = collectRenderableFinancialAnalysisScenarios(
      [validScenario, invalidScenario],
      0.08,
    );

    expect(collected.validScenarios).toHaveLength(1);
    expect(collected.validScenarios[0]?.id).toBe("valid");
    expect(collected.errors).toEqual([
      expect.objectContaining({ scenarioId: "invalid", name: "Invalid option" }),
    ]);
  });

  it("builds an empty equalized comparison fallback", () => {
    expect(
      createEmptyEqualizedComparisonResult("Equalized comparison is unavailable."),
    ).toEqual({
      hasOverlap: false,
      needsCustomWindow: false,
      message: "Equalized comparison is unavailable.",
      windowStart: "",
      windowEnd: "",
      windowDays: 0,
      windowMonthCount: 0,
      windowSource: "overlap",
      metricsByScenario: {},
    });
  });
});
