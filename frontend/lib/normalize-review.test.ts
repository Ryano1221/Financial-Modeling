import { describe, expect, it } from "vitest";

import type { BackendCanonicalLease, ExtractionReviewTask } from "@/lib/types";
import { hasInvalidCanonicalCoreValues, shouldRequireNormalizeReview } from "@/lib/normalize-review";

function makeCanonical(overrides: Partial<BackendCanonicalLease> = {}): BackendCanonicalLease {
  return {
    scenario_id: "s1",
    scenario_name: "Benbrook Option B",
    premises_name: "Benbrook Suite 200",
    address: "123 Main St, Austin, TX",
    building_name: "Benbrook",
    suite: "200",
    floor: "",
    rsf: 4626,
    lease_type: "NNN",
    commencement_date: "2026-12-01",
    expiration_date: "2034-03-31",
    term_months: 88,
    free_rent_months: 8,
    discount_rate_annual: 0.08,
    rent_schedule: [{ start_month: 0, end_month: 87, rent_psf_annual: 26 }],
    ...overrides,
  };
}

describe("normalize review gate", () => {
  it("does not require manual review for warn-only tasks with usable core fields", () => {
    const reviewTasks: ExtractionReviewTask[] = [
      {
        field_path: "pipeline",
        severity: "warn",
        issue_code: "PIPELINE_FALLBACK",
        message: "Extraction pipeline fallback was used due to a backend processing issue.",
      },
    ];
    const decision = shouldRequireNormalizeReview({
      missingFields: [],
      warnings: [],
      confidenceScore: 0.7,
      reviewTasks,
      canonicalVariants: [makeCanonical()],
    });
    expect(decision.needsReview).toBe(false);
    expect(decision.lowConfidence).toBe(true);
  });

  it("requires manual review when blockers exist", () => {
    const reviewTasks: ExtractionReviewTask[] = [
      {
        field_path: "rent_schedule",
        severity: "blocker",
        issue_code: "RENT_SCHEDULE_COVERAGE",
        message: "Rent schedule does not cover the lease term.",
      },
    ];
    const decision = shouldRequireNormalizeReview({
      missingFields: [],
      warnings: [],
      confidenceScore: 0.92,
      reviewTasks,
      canonicalVariants: [makeCanonical()],
    });
    expect(decision.needsReview).toBe(true);
  });

  it("requires manual review for critical missing fields", () => {
    const decision = shouldRequireNormalizeReview({
      missingFields: ["rent_schedule"],
      warnings: [],
      confidenceScore: 0.9,
      reviewTasks: [],
      canonicalVariants: [makeCanonical()],
    });
    expect(decision.needsReview).toBe(true);
  });

  it("requires manual review for invalid core values", () => {
    const invalid = makeCanonical({ rsf: 0 });
    expect(hasInvalidCanonicalCoreValues(invalid)).toBe(true);
    const decision = shouldRequireNormalizeReview({
      missingFields: [],
      warnings: [],
      confidenceScore: 0.9,
      reviewTasks: [],
      canonicalVariants: [invalid],
    });
    expect(decision.needsReview).toBe(true);
  });

  it("still requires review when confidence is critically low and warn tasks exist", () => {
    const reviewTasks: ExtractionReviewTask[] = [
      {
        field_path: "opex_psf_year_1",
        severity: "warn",
        issue_code: "OPEX_MISSING",
        message: "Document references OpEx/CAM but no year-1 OpEx value was confidently extracted.",
      },
    ];
    const decision = shouldRequireNormalizeReview({
      missingFields: [],
      warnings: [],
      confidenceScore: 0.4,
      reviewTasks,
      canonicalVariants: [makeCanonical()],
    });
    expect(decision.needsReview).toBe(true);
  });
});
