import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildSensitivity,
  defaultSubleaseScenarios,
  runSubleaseRecoveryPortfolio,
} from "@/lib/sublease-recovery/engine";
import type { ExistingObligation } from "@/lib/sublease-recovery/types";
import {
  buildSubleaseRecoveryExportFileName,
  buildSubleaseRecoveryWorkbook,
} from "@/lib/sublease-recovery/export";

function baseExisting(): ExistingObligation {
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

describe("sublease recovery exports", () => {
  it("builds branded workbook with expected scenario-oriented tabs", async () => {
    const existing = baseExisting();
    const scenarios = defaultSubleaseScenarios(existing);
    const results = runSubleaseRecoveryPortfolio(existing, scenarios);
    const sensitivity = buildSensitivity(existing, scenarios[1]);

    const buffer = await buildSubleaseRecoveryWorkbook(existing, results, sensitivity, {
      brokerageName: "JLL",
      clientName: "Meta",
      reportDate: "03.09.2026",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer as ArrayBufferLike) as unknown as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Scenario Comparison",
      "Existing Obligation Cash Flow",
      "Best Case Cash Flow",
      "Realistic Case Cash Flow",
      "Worst Case Cash Flow",
      "Sensitivity Analysis",
      "Assumptions",
    ]);
  });

  it("embeds branding logos into workbook output when provided", async () => {
    const existing = baseExisting();
    const scenarios = defaultSubleaseScenarios(existing);
    const results = runSubleaseRecoveryPortfolio(existing, scenarios);
    const sensitivity = buildSensitivity(existing, scenarios[1]);
    const onePxPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0K0AAAAASUVORK5CYII=";

    const buffer = await buildSubleaseRecoveryWorkbook(existing, results, sensitivity, {
      brokerageName: "JLL",
      clientName: "Meta",
      brokerageLogoDataUrl: onePxPng,
      clientLogoDataUrl: onePxPng,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer as ArrayBufferLike) as unknown as never);
    const media = (workbook as unknown as { model?: { media?: unknown[] } }).model?.media ?? [];
    expect(media.length).toBeGreaterThan(0);
  });

  it("uses platform naming convention for sublease export files", () => {
    const xlsx = buildSubleaseRecoveryExportFileName("xlsx", {
      brokerageName: "JLL Austin",
      clientName: "Meta",
      reportDate: "03.09.2026",
    });
    const pdf = buildSubleaseRecoveryExportFileName("pdf", {
      brokerageName: "JLL Austin",
      clientName: "Meta",
      reportDate: "03.09.2026",
    });
    expect(xlsx).toBe("JLL Austin - Sublease Recovery Financial Analysis - Meta - 03.09.2026.xlsx");
    expect(pdf).toBe("JLL Austin - Sublease Recovery Economic Presentation - Meta - 03.09.2026.pdf");
  });
});
