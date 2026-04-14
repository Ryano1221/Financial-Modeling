import { describe, expect, it } from "vitest";
import type { ScenarioWithId } from "@/lib/types";
import { toDocumentNormalizeSnapshot } from "@/lib/workspace/document-cloud-payloads";
import type { ClientWorkspaceDocument, DocumentNormalizeSnapshot } from "@/lib/workspace/types";
import {
  inferUniformGrowthRateFromRentSchedule,
  normalizerResponseFromSnapshot,
  repairDocumentNormalizeSnapshot,
  repairNormalizerResponse,
  repairScenarioOpexGrowthFromDocuments,
} from "@/lib/lease-extraction-repair";

function makeSnapshot(overrides: Partial<DocumentNormalizeSnapshot> = {}): DocumentNormalizeSnapshot {
  return {
    canonical_lease: {
      building_name: "Vista Ridge",
      suite: "450",
      rsf: 5944,
      lease_type: "NNN",
      commencement_date: "2026-12-01",
      expiration_date: "2032-02-29",
      term_months: 63,
      free_rent_months: 3,
      discount_rate_annual: 0.08,
      document_type_detected: "counter_proposal",
      opex_psf_year_1: 14.5,
      opex_growth_rate: 0,
      expense_structure_type: "nnn",
      rent_schedule: [
        { start_month: 0, end_month: 11, rent_psf_annual: 30.0 },
        { start_month: 12, end_month: 23, rent_psf_annual: 30.9 },
        { start_month: 24, end_month: 35, rent_psf_annual: 31.827 },
        { start_month: 36, end_month: 47, rent_psf_annual: 32.7818 },
        { start_month: 48, end_month: 59, rent_psf_annual: 33.7653 },
        { start_month: 60, end_month: 62, rent_psf_annual: 34.7783 },
      ],
    },
    warnings: [],
    confidence_score: 0.92,
    field_confidence: {},
    option_variants: [],
    ...overrides,
  };
}

describe("lease extraction repair", () => {
  it("infers a stable growth rate from a uniform rent schedule", () => {
    const snapshot = makeSnapshot();
    expect(inferUniformGrowthRateFromRentSchedule(snapshot.canonical_lease.rent_schedule)).toBeCloseTo(0.03, 4);
  });

  it("repairs legacy normalize snapshots that missed OpEx growth", () => {
    const repaired = repairDocumentNormalizeSnapshot(makeSnapshot());
    expect(repaired?.canonical_lease.opex_growth_rate).toBeCloseTo(0.03, 4);
    expect(repaired?.warnings).toContain("Applied legacy snapshot OpEx growth repair from the rent escalation schedule.");
  });

  it("repairs saved scenarios from their linked source document snapshot", () => {
    const scenario: ScenarioWithId = {
      id: "scenario-1",
      name: "Vista Ridge Suite 450",
      source_document_id: "doc-1",
      source_document_name: "Vista Ridge Counter",
      document_type_detected: "counter_proposal",
      building_name: "Vista Ridge",
      suite: "450",
      floor: "",
      address: "",
      notes: "",
      rsf: 5944,
      commencement: "2026-12-01",
      expiration: "2032-02-29",
      rent_steps: [
        { start: 0, end: 11, rate_psf_yr: 30.0 },
        { start: 12, end: 23, rate_psf_yr: 30.9 },
        { start: 24, end: 35, rate_psf_yr: 31.827 },
        { start: 36, end: 47, rate_psf_yr: 32.7818 },
        { start: 48, end: 59, rate_psf_yr: 33.7653 },
        { start: 60, end: 62, rate_psf_yr: 34.7783 },
      ],
      free_rent_months: 3,
      free_rent_start_month: 0,
      free_rent_end_month: 2,
      free_rent_abatement_type: "base",
      abatement_periods: [{ start_month: 0, end_month: 2, abatement_type: "base" }],
      ti_allowance_psf: 41,
      ti_allowance_source_of_truth: "psf",
      ti_budget_total: 243704,
      ti_source_of_truth: "psf",
      opex_mode: "nnn",
      base_opex_psf_yr: 14.5,
      base_year_opex_psf_yr: 14.5,
      opex_growth: 0,
      discount_rate_annual: 0.08,
      parking_spaces: 0,
      parking_cost_monthly_per_space: 0,
      parking_sales_tax_rate: 0.0825,
    };
    const document: ClientWorkspaceDocument = {
      id: "doc-1",
      clientId: "client-1",
      name: "Vista Ridge Counter",
      type: "proposals",
      building: "Vista Ridge",
      address: "",
      suite: "450",
      parsed: true,
      uploadedBy: "User",
      uploadedAt: "2026-03-24T00:00:00.000Z",
      sourceModule: "financial-analyses",
      normalizeSnapshot: makeSnapshot(),
    };

    const repaired = repairScenarioOpexGrowthFromDocuments(scenario, [document]);
    expect(repaired.opex_growth).toBeCloseTo(0.03, 4);
  });

  it("repairs legacy snapshot confidence and strips stale resolved review tasks", () => {
    const repaired = repairDocumentNormalizeSnapshot(makeSnapshot({
      confidence_score: 0,
      review_tasks: [
        {
          field_path: "commencement_date",
          severity: "blocker",
          issue_code: "MISSING_TERM_COMMENCEMENT_DATE",
          message: "Commencement date was not confidently extracted.",
        },
        {
          field_path: "expiration_date",
          severity: "warn",
          issue_code: "UNCLEAR_EXPIRATION_DATE",
          message: "Expiration date remained unclear.",
        },
      ],
    }));
    expect(repaired?.confidence_score).toBeGreaterThanOrEqual(0.9);
    expect(repaired?.review_tasks).toEqual([]);
    expect(repaired?.warnings).toContain("Recovered a durable confidence score for a saved lease snapshot so the extractor can auto-add it consistently.");
    expect(repaired?.warnings).toContain("Resolved stale extraction review flags from the saved canonical lease terms.");
  });

  it("builds an auto-add normalizer response from a repaired snapshot", () => {
    const response = normalizerResponseFromSnapshot(makeSnapshot({
      confidence_score: 0,
      review_tasks: [
        {
          field_path: "rent_schedule",
          severity: "blocker",
          issue_code: "MISSING_RENT_SCHEDULE",
          message: "Rent schedule could not be confirmed.",
        },
      ],
    }));
    expect(response?.confidence_score).toBeGreaterThanOrEqual(0.9);
    expect(response?.review_tasks).toEqual([]);
    expect(response?.export_allowed).toBe(true);
    expect((response?.extraction_confidence as { status?: string } | undefined)?.status).toBe("green");
  });

  it("preserves deep canonical extraction rights from saved snapshots", () => {
    const response = normalizerResponseFromSnapshot(makeSnapshot({
      canonical_extraction: {
        rights_options: {
          renewal_option: "Renewal notice no later than July 31, 2029.",
          termination_right: "Termination effective as of April 30, 2028 with notice no later than October 31, 2027.",
        },
      },
    }));

    expect(response?.canonical_extraction?.rights_options).toEqual({
      renewal_option: "Renewal notice no later than July 31, 2029.",
      termination_right: "Termination effective as of April 30, 2028 with notice no later than October 31, 2027.",
    });
  });

  it("keeps canonical extraction when converting live normalize responses into document snapshots", () => {
    const snapshot = toDocumentNormalizeSnapshot({
      canonical_lease: makeSnapshot().canonical_lease,
      confidence_score: 0.95,
      field_confidence: {},
      missing_fields: [],
      clarification_questions: [],
      warnings: [],
      canonical_extraction: {
        rights_options: {
          renewal_option: "Renewal notice no later than July 31, 2029.",
        },
      },
    });

    expect(snapshot?.canonical_extraction?.rights_options).toEqual({
      renewal_option: "Renewal notice no later than July 31, 2029.",
    });
  });

  it("repairs live normalize payloads before they are gated", () => {
    const repaired = repairNormalizerResponse({
      canonical_lease: makeSnapshot().canonical_lease,
      confidence_score: 0,
      field_confidence: {},
      missing_fields: ["commencement_date", "rent_schedule"],
      clarification_questions: [],
      warnings: [],
      review_tasks: [
        {
          field_path: "term_months",
          severity: "warn",
          issue_code: "UNCLEAR_TERM_LENGTH",
          message: "Term length was unclear.",
        },
      ],
      export_allowed: false,
    });
    expect(repaired?.confidence_score).toBeGreaterThanOrEqual(0.9);
    expect(repaired?.review_tasks).toEqual([]);
    expect(repaired?.missing_fields).toEqual([]);
    expect(repaired?.export_allowed).toBe(true);
  });
});
