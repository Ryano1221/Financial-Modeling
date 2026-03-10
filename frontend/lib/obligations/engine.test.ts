import { describe, expect, it } from "vitest";
import type { NormalizerResponse } from "@/lib/types";
import {
  buildTimelineBuckets,
  computeObligationCompleteness,
  computePortfolioMetrics,
  findMatchingObligation,
  inferObligationDocumentKind,
  mapNormalizeToObligationSeed,
} from "@/lib/obligations/engine";
import type { ObligationRecord } from "@/lib/obligations/types";

function makeNormalize(overrides: Partial<NormalizerResponse> = {}): NormalizerResponse {
  return {
    canonical_lease: {
      rsf: 50000,
      lease_type: "NNN",
      commencement_date: "2028-04-01",
      expiration_date: "2036-10-31",
      term_months: 103,
      free_rent_months: 0,
      discount_rate_annual: 0.08,
      rent_schedule: [{ start_month: 0, end_month: 11, rent_psf_annual: 44 }],
      opex_psf_year_1: 12,
      building_name: "400 W 6th St",
      address: "400 W 6th St, Austin, TX",
      suite: "26-28",
      notes: "Tenant has one renewal option. Notice due by 10/01/2035.",
    },
    confidence_score: 0.95,
    field_confidence: {},
    missing_fields: [],
    clarification_questions: [],
    warnings: [],
    review_tasks: [],
    extraction_summary: { document_type_detected: "landlord proposal", key_terms_found: [], key_terms_missing: [], sections_searched: [] },
    ...overrides,
  };
}

function makeObligation(overrides: Partial<ObligationRecord> = {}): ObligationRecord {
  return {
    id: "obl-1",
    companyId: "co-1",
    title: "400 W 6th St Suite 26-28",
    buildingName: "400 W 6th St",
    address: "400 W 6th St, Austin, TX",
    suite: "26-28",
    floor: "",
    leaseType: "NNN",
    rsf: 50000,
    commencementDate: "2028-04-01",
    expirationDate: "2036-10-31",
    rentCommencementDate: "2028-04-01",
    noticeDate: "2035-10-01",
    renewalDate: "",
    terminationRightDate: "",
    annualObligation: 2800000,
    totalObligation: 24000000,
    completenessScore: 100,
    sourceDocumentIds: ["proposal.docx"],
    linkedAnalysisCount: 0,
    linkedSurveyCount: 0,
    createdAtIso: "2026-01-01T00:00:00.000Z",
    updatedAtIso: "2026-01-01T00:00:00.000Z",
    notes: "",
    ...overrides,
  };
}

describe("obligations/engine", () => {
  it("maps normalize output into obligation seed values", () => {
    const seed = mapNormalizeToObligationSeed(makeNormalize(), "proposal.docx");
    expect(seed.buildingName).toBe("400 W 6th St");
    expect(seed.suite).toBe("26-28");
    expect(seed.rsf).toBe(50000);
    expect(seed.annualObligation).toBeGreaterThan(0);
    expect(seed.kind).toBe("proposal");
  });

  it("infers document kinds with precedence", () => {
    expect(inferObligationDocumentKind("ATX Tower Lease Amendment 2.docx")).toBe("amendment");
    expect(inferObligationDocumentKind("Counter Proposal.pdf")).toBe("counter");
    expect(inferObligationDocumentKind("Sublease LOI.docx")).toBe("sublease");
  });

  it("finds matching obligation by address and suite", () => {
    const existing = [makeObligation()];
    const match = findMatchingObligation(existing, "co-1", mapNormalizeToObligationSeed(makeNormalize(), "proposal.docx"));
    expect(match?.id).toBe("obl-1");
  });

  it("computes completeness and timeline metrics", () => {
    const obligation = makeObligation();
    const score = computeObligationCompleteness(obligation);
    expect(score).toBeGreaterThan(70);

    const portfolio = computePortfolioMetrics([obligation], 3, new Date("2035-08-01T00:00:00.000Z"));
    expect(portfolio.obligationCount).toBe(1);
    expect(portfolio.documentCount).toBe(3);

    const timeline = buildTimelineBuckets([obligation], 2035);
    expect(timeline.find((row) => row.year === 2036)?.expiringCount).toBe(1);
    expect(timeline.find((row) => row.year === 2035)?.noticeCount).toBe(1);
  });
});
