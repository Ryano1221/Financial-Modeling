import { describe, expect, it } from "vitest";

import { mergeImportedFinancialAnalysisScenario, upsertRegisteredDocument } from "@/lib/financial-analysis-import";
import type { ScenarioWithId } from "@/lib/types";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

function makeScenario(overrides: Partial<ScenarioWithId> = {}): ScenarioWithId {
  return {
    id: overrides.id ?? "scenario-1",
    name: overrides.name ?? "1300 East 5th Floor 4th",
    building_name: overrides.building_name ?? "1300 East 5th",
    suite: overrides.suite ?? "",
    floor: overrides.floor ?? "4th",
    address: overrides.address ?? "",
    notes: overrides.notes ?? "",
    rsf: overrides.rsf ?? 12153,
    commencement: overrides.commencement ?? "2026-12-01",
    expiration: overrides.expiration ?? "2032-05-31",
    rent_steps: overrides.rent_steps ?? [{ start: 0, end: 11, rate_psf_yr: 43.5 }],
    free_rent_months: overrides.free_rent_months ?? 6,
    free_rent_start_month: overrides.free_rent_start_month ?? 0,
    free_rent_end_month: overrides.free_rent_end_month ?? 5,
    free_rent_abatement_type: overrides.free_rent_abatement_type ?? "base",
    abatement_periods: overrides.abatement_periods,
    parking_abatement_periods: overrides.parking_abatement_periods,
    ti_allowance_psf: overrides.ti_allowance_psf ?? 5,
    ti_allowance_source_of_truth: overrides.ti_allowance_source_of_truth ?? "psf",
    ti_budget_total: overrides.ti_budget_total ?? 60765,
    ti_source_of_truth: overrides.ti_source_of_truth ?? "psf",
    opex_mode: overrides.opex_mode ?? "nnn",
    base_opex_psf_yr: overrides.base_opex_psf_yr ?? 20.06,
    base_year_opex_psf_yr: overrides.base_year_opex_psf_yr ?? 20.06,
    opex_growth: overrides.opex_growth ?? 0,
    discount_rate_annual: overrides.discount_rate_annual ?? 0.08,
    parking_spaces: overrides.parking_spaces ?? 33,
    parking_cost_monthly_per_space: overrides.parking_cost_monthly_per_space ?? 185,
    parking_sales_tax_rate: overrides.parking_sales_tax_rate ?? 0.0825,
    document_type_detected: overrides.document_type_detected ?? "proposal",
    source_document_id: overrides.source_document_id ?? "doc-5",
    source_document_name: overrides.source_document_name ?? "1300 E 5th_Sprinklr_LL_REVISED_4.6.26(5_Year).docx",
  };
}

function makeDocument(overrides: Partial<ClientWorkspaceDocument> = {}): ClientWorkspaceDocument {
  return {
    id: overrides.id ?? "doc-1",
    clientId: overrides.clientId ?? "client-1",
    name: overrides.name ?? "1300 E 5th_Sprinklr_LL_REVISED_4.6.26(5_Year).docx",
    type: overrides.type ?? "proposals",
    building: overrides.building ?? "1300 East 5th",
    address: overrides.address ?? "",
    suite: overrides.suite ?? "",
    parsed: overrides.parsed ?? true,
    uploadedBy: overrides.uploadedBy ?? "User",
    uploadedAt: overrides.uploadedAt ?? "2026-04-08T12:00:00.000Z",
    sourceModule: overrides.sourceModule ?? "financial-analyses",
    normalizeSnapshot: overrides.normalizeSnapshot,
  };
}

describe("mergeImportedFinancialAnalysisScenario", () => {
  it("replaces the prior scenario when the same source document is re-imported with the same economic signature", () => {
    const stale = makeScenario({
      id: "stale",
      opex_growth: 0.03,
      ti_allowance_psf: 0,
      ti_budget_total: 0,
    });
    const fresh = makeScenario({
      id: "fresh",
      opex_growth: 0,
      ti_allowance_psf: 5,
      ti_budget_total: 60765,
    });

    const merged = mergeImportedFinancialAnalysisScenario([stale], fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("fresh");
    expect(merged[0].ti_allowance_psf).toBe(5);
    expect(merged[0].opex_growth).toBe(0);
  });

  it("keeps distinct options from the same source document when their economics differ", () => {
    const optionA = makeScenario({
      id: "a",
      expiration: "2032-05-31",
      ti_allowance_psf: 5,
      source_document_id: "doc-shared",
      source_document_name: "shared.docx",
    });
    const optionB = makeScenario({
      id: "b",
      expiration: "2034-06-30",
      free_rent_months: 7,
      free_rent_end_month: 6,
      ti_allowance_psf: 10,
      ti_budget_total: 121530,
      source_document_id: "doc-shared",
      source_document_name: "shared.docx",
    });

    const merged = mergeImportedFinancialAnalysisScenario([optionA], optionB);
    expect(merged).toHaveLength(2);
    expect(merged.map((scenario) => scenario.id)).toEqual(["a", "b"]);
  });
});

describe("upsertRegisteredDocument", () => {
  it("overwrites an older saved document snapshot when the document id matches", () => {
    const older = makeDocument({
      id: "doc-old",
      uploadedAt: "2026-04-07T12:00:00.000Z",
    });
    const newer = makeDocument({
      id: "doc-old",
      uploadedAt: "2026-04-08T12:00:00.000Z",
    });

    const documents = upsertRegisteredDocument([older], newer);
    expect(documents).toHaveLength(1);
    expect(documents[0].uploadedAt).toBe("2026-04-08T12:00:00.000Z");
  });

  it("keeps separate documents when different uploads share the same file name", () => {
    const first = makeDocument({ id: "doc-1", name: "shared.docx" });
    const second = makeDocument({ id: "doc-2", name: "shared.docx" });

    const documents = upsertRegisteredDocument([first], second);
    expect(documents).toHaveLength(2);
    expect(documents.map((document) => document.id)).toEqual(["doc-2", "doc-1"]);
  });
});
