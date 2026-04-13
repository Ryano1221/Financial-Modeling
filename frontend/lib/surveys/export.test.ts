import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { SurveyEntry } from "@/lib/surveys/types";
import {
  buildSurveysExportFileName,
  buildSurveysWorkbook,
} from "@/lib/surveys/export";

function sampleEntries(): SurveyEntry[] {
  return [
    {
      id: "survey-1",
      clientId: "client-1",
      sourceDocumentId: "doc-1",
      sourceDocumentName: "Alpha Tower Proposal.pdf",
      sourceType: "parsed_document",
      uploadedAtIso: "2026-04-10T10:00:00.000Z",
      buildingName: "Alpha Tower",
      address: "100 Main St, Austin, TX",
      floor: "12",
      suite: "1200",
      availableSqft: 15000,
      baseRentPsfAnnual: 39.5,
      opexPsfAnnual: 14.25,
      leaseType: "NNN",
      occupancyType: "Direct",
      sublessor: "",
      subleaseExpirationDate: "",
      parkingSpaces: 45,
      parkingRateMonthlyPerSpace: 165,
      notes: "Strong direct option with efficient floorplate.",
      needsReview: false,
      reviewReasons: [],
      reviewTasks: [],
      fieldConfidence: {},
    },
    {
      id: "survey-2",
      clientId: "client-1",
      sourceDocumentId: "doc-2",
      sourceDocumentName: "Beta Plaza Sublease.pdf",
      sourceType: "parsed_document",
      uploadedAtIso: "2026-04-09T10:00:00.000Z",
      buildingName: "Beta Plaza",
      address: "200 Elm St, Austin, TX",
      floor: "8",
      suite: "800",
      availableSqft: 11000,
      baseRentPsfAnnual: 33.75,
      opexPsfAnnual: 8.5,
      leaseType: "Modified Gross",
      occupancyType: "Sublease",
      sublessor: "Acme Labs",
      subleaseExpirationDate: "2029-06-30",
      parkingSpaces: 30,
      parkingRateMonthlyPerSpace: 140,
      notes: "Sublease with below-market economics but shorter remaining term.",
      needsReview: true,
      reviewReasons: ["Confirm sublease expiration date.", "Parking ratio needs analyst confirmation."],
      reviewTasks: [],
      fieldConfidence: {},
    },
  ];
}

describe("surveys export", () => {
  it("builds the branded workbook tabs for summary, comparison, profiles, and review queue", async () => {
    const buffer = await buildSurveysWorkbook(sampleEntries(), {
      brokerageName: "JLL Austin",
      clientName: "Meta",
      reportDate: "04.10.2026",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer as ArrayBufferLike) as unknown as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Survey Comparison",
      "Entry Profiles",
      "Review Queue",
    ]);
  });

  it("embeds branding logos when provided", async () => {
    const onePxPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0K0AAAAASUVORK5CYII=";

    const buffer = await buildSurveysWorkbook(sampleEntries(), {
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

  it("uses the updated platform naming convention", () => {
    expect(
      buildSurveysExportFileName("xlsx", {
        brokerageName: "JLL Austin",
        clientName: "Meta",
        reportDate: "04.10.2026",
      }),
    ).toBe("JLL Austin - Survey Financial Analysis - Meta - 04.10.2026.xlsx");

    expect(
      buildSurveysExportFileName("pdf", {
        brokerageName: "JLL Austin",
        clientName: "Meta",
        reportDate: "04.10.2026",
      }),
    ).toBe("JLL Austin - Survey Economic Presentation - Meta - 04.10.2026.pdf");
  });
});
