import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { BackendCanonicalLease } from "@/lib/types";
import type { CompletedLeaseAbstractView, CompletedLeaseDocumentRecord } from "@/lib/completed-leases/types";
import {
  buildCompletedLeaseAbstractFileName,
  buildCompletedLeaseAbstractWorkbook,
} from "@/lib/completed-leases/export";

function baseCanonical(): BackendCanonicalLease {
  return {
    tenant_name: "Meta Platforms, Inc.",
    landlord_name: "Downtown Holdings LP",
    premises_name: "Centre One Suite 1200",
    building_name: "Centre One",
    address: "100 Congress Ave, Austin, TX",
    suite: "1200",
    floor: "12",
    rsf: 15000,
    lease_type: "NNN",
    commencement_date: "2026-01-01",
    rent_commencement_date: "2026-02-01",
    expiration_date: "2031-01-31",
    term_months: 61,
    free_rent_months: 4,
    discount_rate_annual: 0.08,
    rent_schedule: [
      { start_month: 0, end_month: 11, rent_psf_annual: 42 },
      { start_month: 12, end_month: 23, rent_psf_annual: 43.5 },
    ],
    opex_psf_year_1: 14.5,
    opex_growth_rate: 0.03,
    expense_structure_type: "NNN",
    parking_count: 45,
    parking_rate_monthly: 165,
    parking_sales_tax_rate: 0.0825,
    security_deposit_months: 2,
    security_deposit: "Two months of gross rent",
    guaranty: "Parent guaranty",
    options: "One 5-year renewal option",
    notice_dates: "Notice due 9 months prior to expiration",
    renewal_options: "One 5-year renewal option at FMV",
    termination_rights: "No early termination right",
    ti_allowance_psf: 55,
    ti_budget_total: 825000,
    notes: "Parking ratio 3.0/1,000. Tenant improvement allowance expires 12 months after commencement.",
  };
}

function sourceDocument(overrides: Partial<CompletedLeaseDocumentRecord>): CompletedLeaseDocumentRecord {
  return {
    id: "lease-1",
    clientId: "client-1",
    fileName: "Centre One Lease.pdf",
    uploadedAtIso: "2026-04-10T10:00:00.000Z",
    kind: "lease",
    canonical: baseCanonical(),
    fieldConfidence: {},
    warnings: [],
    reviewTasks: [],
    source: { canonical_lease: baseCanonical(), confidence_score: 0.95, field_confidence: {}, missing_fields: [], clarification_questions: [], warnings: [] },
    ...overrides,
  };
}

function sampleAbstract(): CompletedLeaseAbstractView {
  const leaseDoc = sourceDocument({});
  const amendmentDoc = sourceDocument({
    id: "amend-1",
    kind: "amendment",
    fileName: "First Amendment.pdf",
    uploadedAtIso: "2027-01-15T10:00:00.000Z",
    canonical: {
      ...baseCanonical(),
      expiration_date: "2032-01-31",
      term_months: 73,
      notes: "First amendment extends the term and refreshes the TI package.",
    },
  });

  return {
    controllingCanonical: baseCanonical(),
    controllingDocumentId: leaseDoc.id,
    sourceDocuments: [leaseDoc, amendmentDoc],
    overrideNotes: ["First Amendment.pdf overrides expiration_date (2031-01-31 -> 2032-01-31)."],
  };
}

describe("completed lease export", () => {
  it("builds the branded workbook tabs for abstract delivery", async () => {
    const buffer = await buildCompletedLeaseAbstractWorkbook(sampleAbstract(), {
      brokerageName: "JLL Austin",
      clientName: "Meta",
      reportDate: "04.10.2026",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer as ArrayBufferLike) as unknown as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Lease Abstract",
      "Rent Schedule",
      "Source Documents",
      "Audit Notes",
    ]);
  });

  it("embeds branding logos when provided", async () => {
    const onePxPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0K0AAAAASUVORK5CYII=";

    const buffer = await buildCompletedLeaseAbstractWorkbook(sampleAbstract(), {
      brokerageName: "JLL Austin",
      clientName: "Meta",
      brokerageLogoDataUrl: onePxPng,
      clientLogoDataUrl: onePxPng,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer as ArrayBufferLike) as unknown as never);
    const media = (workbook as unknown as { model?: { media?: unknown[] } }).model?.media ?? [];

    expect(media.length).toBeGreaterThan(0);
  });

  it("uses the updated lease abstract naming convention", () => {
    expect(
      buildCompletedLeaseAbstractFileName("xlsx", {
        brokerageName: "JLL Austin",
        clientName: "Meta",
        reportDate: "04.10.2026",
      }),
    ).toBe("JLL Austin - Lease Abstract - Meta - 04.10.2026.xlsx");

    expect(
      buildCompletedLeaseAbstractFileName("pdf", {
        brokerageName: "JLL Austin",
        clientName: "Meta",
        reportDate: "04.10.2026",
      }),
    ).toBe("JLL Austin - Lease Abstract Presentation - Meta - 04.10.2026.pdf");
  });
});
