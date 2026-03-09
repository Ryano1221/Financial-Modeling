import { describe, expect, it } from "vitest";
import { mapProposalToScenarioDraft } from "@/lib/sublease-recovery/proposal-import";
import type { ExistingObligation } from "@/lib/sublease-recovery/types";
import type { NormalizerResponse } from "@/lib/types";

function existing(): ExistingObligation {
  return {
    premises: "Test Tower Suite 100",
    rsf: 10000,
    commencementDate: "2026-01-01",
    expirationDate: "2031-01-31",
    leaseType: "nnn",
    baseRentSchedule: [{ startMonth: 0, endMonth: 60, annualRatePsf: 42 }],
    baseOperatingExpense: 12,
    annualOperatingExpenseEscalation: 0.03,
    parkingRatio: 3,
    allottedParkingSpaces: 30,
    reservedPaidSpaces: 0,
    unreservedPaidSpaces: 30,
    parkingCostPerSpace: 150,
    annualParkingEscalation: 0.03,
    parkingSalesTax: 0.0825,
    abatements: [],
    phaseInEvents: [],
  };
}

describe("proposal import mapping", () => {
  it("maps normalized extraction into a proposal-backed scenario", () => {
    const normalize: NormalizerResponse = {
      canonical_lease: {
        rsf: 6052,
        commencement_date: "2026-04-01",
        expiration_date: "2031-03-31",
        term_months: 60,
        discount_rate_annual: 0.08,
        lease_type: "Modified Gross",
        expense_structure_type: "base_year",
        rent_schedule: [
          { start_month: 0, end_month: 11, rent_psf_annual: 47.5 },
          { start_month: 12, end_month: 23, rent_psf_annual: 48.93 },
        ],
        opex_psf_year_1: 31.18,
        opex_growth_rate: 0.03,
        free_rent_months: 9,
        free_rent_scope: "gross",
        free_rent_periods: [{ start_month: 0, end_month: 8, scope: "gross" }],
        parking_count: 257,
        parking_rate_monthly: 200,
        commission_rate: 0.06,
      },
      confidence_score: 0.89,
      field_confidence: {},
      missing_fields: [],
      clarification_questions: [],
      warnings: [],
      review_tasks: [],
      canonical_extraction: {
        proposal: {
          proposal_name: "6xGuad Counter",
          property_name: "400 W 6th St",
          subtenant_name: "Meta Platforms, Inc.",
          guarantor: "Meta Platforms Holdings LLC",
          broker_name: "JLL",
        },
        provenance: {
          "proposal.subtenant_name": [{ snippet: "Subtenant: Meta Platforms, Inc.", source_confidence: 0.9, page: 1 }],
        },
      },
    };

    const draft = mapProposalToScenarioDraft(normalize, existing(), "meta-counter.docx");

    expect(draft.scenario.sourceType).toBe("proposal_import");
    expect(draft.scenario.name).toBe("6xGuad Counter");
    expect(draft.scenario.subtenantName).toBe("Meta Platforms, Inc.");
    expect(draft.scenario.rsf).toBe(6052);
    expect(draft.scenario.baseRent).toBe(47.5);
    expect(draft.scenario.explicitBaseRentSchedule?.length).toBe(2);
    expect(draft.scenario.leaseType).toBe("base_year");
    expect(draft.fieldReview.some((field) => field.key === "subtenantName")).toBe(true);
  });
});
