import { describe, expect, it } from "vitest";
import type { NormalizerResponse } from "@/lib/types";
import { computeSurveyMonthlyOccupancyCost, createManualSurveyEntryFromImage, mapNormalizeToSurveyEntry } from "@/lib/surveys/engine";

function makeNormalize(overrides: Partial<NormalizerResponse> = {}): NormalizerResponse {
  return {
    canonical_lease: {
      rsf: 10000,
      lease_type: "NNN",
      commencement_date: "2026-01-01",
      expiration_date: "2031-12-31",
      term_months: 72,
      free_rent_months: 0,
      discount_rate_annual: 0.08,
      rent_schedule: [{ start_month: 0, end_month: 11, rent_psf_annual: 45 }],
      opex_psf_year_1: 12,
      building_name: "ATX Tower",
      address: "123 Main St, Austin, TX",
      suite: "1500",
      floor: "15",
      parking_count: 20,
      parking_rate_monthly: 165,
    },
    confidence_score: 0.92,
    extraction_summary: { document_type_detected: "proposal" },
    field_confidence: { rsf: 0.95, lease_type: 0.91, rent_schedule: 0.9 },
    missing_fields: [],
    clarification_questions: [],
    warnings: [],
    review_tasks: [],
    ...overrides,
  };
}

describe("surveys/engine", () => {
  it("maps normalize response to survey entry", () => {
    const normalize = makeNormalize();
    const entry = mapNormalizeToSurveyEntry(normalize, "flyer.pdf");
    expect(entry.buildingName).toBe("ATX Tower");
    expect(entry.availableSqft).toBe(10000);
    expect(entry.baseRentPsfAnnual).toBe(45);
    expect(entry.leaseType).toBe("NNN");
    expect(entry.needsReview).toBe(false);
  });

  it("flags review when key terms are missing", () => {
    const normalize = makeNormalize({
      canonical_lease: {
        ...makeNormalize().canonical_lease,
        rsf: 0,
        rent_schedule: [],
        lease_type: "",
      },
      field_confidence: { rsf: 0.4, lease_type: 0.4 },
    });
    const entry = mapNormalizeToSurveyEntry(normalize, "marketing.pdf");
    expect(entry.needsReview).toBe(true);
    expect(entry.reviewReasons.length).toBeGreaterThan(0);
  });

  it("computes monthly occupancy by lease type rules", () => {
    const normalize = makeNormalize();
    const entry = mapNormalizeToSurveyEntry(normalize, "flyer.pdf");
    const nnn = computeSurveyMonthlyOccupancyCost(entry);
    expect(Math.round(nnn.totalMonthly)).toBe(50800);

    const gross = computeSurveyMonthlyOccupancyCost({ ...entry, leaseType: "Gross" });
    expect(gross.opexMonthly).toBe(0);
    expect(gross.totalMonthly).toBeLessThan(nnn.totalMonthly);

    const modGross = computeSurveyMonthlyOccupancyCost({ ...entry, leaseType: "Modified Gross" });
    expect(Math.round(modGross.opexMonthly)).toBe(5000);
  });

  it("creates manual image entry with review required", () => {
    const manual = createManualSurveyEntryFromImage("floorplan.png");
    expect(manual.sourceType).toBe("manual_image");
    expect(manual.needsReview).toBe(true);
    expect(manual.reviewReasons.length).toBeGreaterThan(0);
  });

  it("infers sublessor fields for sublease survey records", () => {
    const normalize = makeNormalize({
      extraction_summary: { document_type_detected: "sublease flyer" },
      canonical_lease: {
        ...makeNormalize().canonical_lease,
        tenant_name: "Sublessor Co",
      },
    });
    const entry = mapNormalizeToSurveyEntry(normalize, "sublease-flyer.pdf");
    expect(entry.occupancyType).toBe("Sublease");
    expect(entry.sublessor).toBe("Sublessor Co");
    expect(entry.subleaseExpirationDate).toBe("2031-12-31");
  });
});
