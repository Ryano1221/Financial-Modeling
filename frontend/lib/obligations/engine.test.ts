import { describe, expect, it } from "vitest";
import type { NormalizerResponse } from "@/lib/types";
import {
  buildTimelineBuckets,
  computeObligationCompleteness,
  computePortfolioMetrics,
  findMatchingObligation,
  inferObligationDocumentKind,
  mapNormalizeToObligationSeed,
  pruneObligationsForAvailableSourceDocuments,
} from "@/lib/obligations/engine";
import type { ObligationDocumentRecord, ObligationRecord } from "@/lib/obligations/types";

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
    clientId: "client-1",
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

function makeObligationDocument(overrides: Partial<ObligationDocumentRecord> = {}): ObligationDocumentRecord {
  return {
    id: "obl-doc-1",
    clientId: "client-1",
    sourceDocumentId: "doc-1",
    companyId: "co-1",
    obligationId: "obl-1",
    fileName: "proposal.docx",
    kind: "lease",
    uploadedAtIso: "2026-01-01T00:00:00.000Z",
    confidenceScore: 0.95,
    reviewRequired: false,
    parseWarnings: [],
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

  it("extracts notice, renewal, and termination dates from canonical fields", () => {
    const seed = mapNormalizeToObligationSeed(
      makeNormalize({
        canonical_lease: {
          ...makeNormalize().canonical_lease,
          notes: "",
          notice_dates: "Notice deadline: September 15, 2035",
          renewal_options: "Renewal election due on 2036-02-01",
          termination_rights: "Termination right available 10/15/2036",
        },
      }),
      "proposal.docx",
    );

    expect(seed.noticeDate).toBe("2035-09-15");
    expect(seed.renewalDate).toBe("2036-02-01");
    expect(seed.terminationRightDate).toBe("2036-10-15");
  });

  it("maps deep extraction rights clauses into obligation timeline dates", () => {
    const seed = mapNormalizeToObligationSeed(
      makeNormalize({
        canonical_lease: {
          ...makeNormalize().canonical_lease,
          notes: "",
          expiration_date: "2030-04-30",
        },
        canonical_extraction: {
          rights_options: {
            renewal_option:
              "Tenant shall have one (1) option to renew this Lease for one (1) additional period of three (3) years, commencing May 1, 2030 and expiring April 30, 2033. Tenant shall exercise the Renewal Option by delivering written notice no earlier than fifteen (15) months and no later than nine (9) months prior to the Expiration Date (i.e., between February 1, 2029 and July 31, 2029).",
            termination_right:
              "Tenant shall have a one-time option to terminate this Lease effective as of April 30, 2028. To exercise the Termination Option, Tenant must deliver written notice to Landlord no later than October 31, 2027.",
          },
        },
      }),
      "YC_Pier70_Lease.docx",
    );

    expect(seed.noticeDate).toBe("2027-10-31");
    expect(seed.renewalDate).toBe("2029-07-31");
    expect(seed.terminationRightDate).toBe("2028-04-30");
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

  it("removes an obligation when its only source document was deleted", () => {
    const pruned = pruneObligationsForAvailableSourceDocuments(
      [makeObligation()],
      [makeObligationDocument()],
      [],
      "2026-02-01T00:00:00.000Z",
    );

    expect(pruned.documents).toEqual([]);
    expect(pruned.obligations).toEqual([]);
    expect(pruned.removedDocumentCount).toBe(1);
    expect(pruned.removedObligationCount).toBe(1);
  });

  it("keeps an obligation when another source document remains linked", () => {
    const pruned = pruneObligationsForAvailableSourceDocuments(
      [makeObligation({ sourceDocumentIds: ["proposal.docx", "amendment.docx"] })],
      [
        makeObligationDocument({ id: "obl-doc-1", sourceDocumentId: "doc-1", fileName: "proposal.docx" }),
        makeObligationDocument({ id: "obl-doc-2", sourceDocumentId: "doc-2", fileName: "amendment.docx" }),
      ],
      ["doc-2"],
      "2026-02-01T00:00:00.000Z",
    );

    expect(pruned.documents.map((doc) => doc.sourceDocumentId)).toEqual(["doc-2"]);
    expect(pruned.obligations).toHaveLength(1);
    expect(pruned.obligations[0]?.sourceDocumentIds).toEqual(["amendment.docx"]);
    expect(pruned.obligations[0]?.updatedAtIso).toBe("2026-02-01T00:00:00.000Z");
    expect(pruned.removedDocumentCount).toBe(1);
    expect(pruned.removedObligationCount).toBe(0);
  });

  it("computes completeness and timeline metrics", () => {
    const obligation = makeObligation({
      expirationDate: "2036-05-31",
      renewalDate: "2036-02-01",
      terminationRightDate: "2036-03-15",
    });
    const score = computeObligationCompleteness(obligation);
    expect(score).toBeGreaterThan(70);

    const portfolio = computePortfolioMetrics([obligation], 3, new Date("2035-08-01T00:00:00.000Z"));
    expect(portfolio.obligationCount).toBe(1);
    expect(portfolio.documentCount).toBe(3);
    expect(portfolio.expiringWithin12Months).toBe(1);
    expect(portfolio.upcomingNoticeWithin6Months).toBe(1);
    expect(portfolio.upcomingRenewalWithin12Months).toBe(1);
    expect(portfolio.upcomingTerminationWithin12Months).toBe(1);

    const timeline = buildTimelineBuckets([obligation], 2035);
    expect(timeline.find((row) => row.year === 2036)?.expiringCount).toBe(1);
    expect(timeline.find((row) => row.year === 2035)?.noticeCount).toBe(1);
    expect(timeline.find((row) => row.year === 2036)?.renewalCount).toBe(1);
    expect(timeline.find((row) => row.year === 2036)?.terminationCount).toBe(1);
  });

  it("extends timeline buckets to include far-dated events", () => {
    const obligation = makeObligation({ expirationDate: "2036-05-31", noticeDate: "", renewalDate: "", terminationRightDate: "" });
    const timeline = buildTimelineBuckets([obligation], 2026);
    expect(timeline[0]?.year).toBe(2026);
    expect(timeline[timeline.length - 1]?.year).toBe(2036);
    expect(timeline.find((row) => row.year === 2036)?.expiringCount).toBe(1);
  });
});
