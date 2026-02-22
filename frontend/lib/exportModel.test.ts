import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  SUMMARY_MATRIX_ROW_LABELS,
  TEMPLATE_VERSION,
  buildBrokerWorkbook,
} from "./exportModel";
import type { LeaseScenarioCanonical } from "./lease-engine/canonical-schema";

describe("exportModel institutional workbook", () => {
  it("exposes required summary labels", () => {
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("Building name");
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("NPV cost");
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("Notes");
  });

  it("template version is defined", () => {
    expect(TEMPLATE_VERSION).toBe("2.0");
  });

  it("builds required workbook sheets and branded headers", async () => {
    const scenario: LeaseScenarioCanonical = {
      id: "fixture-1",
      name: "Fixture Option",
      discountRateAnnual: 0.08,
      partyAndPremises: {
        premisesName: "123 Main Street, Austin, TX",
        premisesLabel: "Main Tower",
        floorsOrSuite: "Suite 100",
        rentableSqFt: 5000,
        leaseType: "nnn",
      },
      datesAndTerm: {
        leaseTermMonths: 60,
        commencementDate: "2026-01-01",
        expirationDate: "2031-01-01",
      },
      rentSchedule: {
        steps: [{ startMonth: 0, endMonth: 59, ratePsfYr: 30 }],
        annualEscalationPercent: 0.03,
      },
      expenseSchedule: {
        leaseType: "nnn",
        baseOpexPsfYr: 10,
        annualEscalationPercent: 0.03,
      },
      parkingSchedule: { slots: [], annualEscalationPercent: 0, salesTaxPercent: 0.0825 },
      tiSchedule: {
        budgetTotal: 100000,
        allowanceFromLandlord: 80000,
        outOfPocket: 20000,
        amortizeOop: false,
      },
      otherCashFlows: { oneTimeCosts: [], brokerFee: 0, securityDepositMonths: 0 },
      notes: "Renewal option available.",
    };

    const buffer = await buildBrokerWorkbook([scenario], 0.08, {
      brokerageName: "Anchor Capital",
      clientName: "Client A",
      reportDate: "2026-02-22",
      preparedBy: "Analyst",
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ArrayBuffer);

    expect(workbook.getWorksheet("Cover")).toBeDefined();
    expect(workbook.getWorksheet("Summary Comparison")).toBeDefined();
    expect(workbook.getWorksheet("Equalized Metrics")).toBeDefined();
    expect(workbook.getWorksheet("Monthly Gross Cash Flow Matrix")).toBeDefined();
    expect(workbook.worksheets.some((sheet) => sheet.name.startsWith("Appendix"))).toBe(true);

    const cover = workbook.getWorksheet("Cover");
    expect((cover?.getCell("A1").value as string) ?? "").toContain("THE COMMERCIAL REAL ESTATE MODEL");

    const summary = workbook.getWorksheet("Summary Comparison");
    expect(summary?.getCell(1, 1).value).toBe("Metric");
    expect(summary?.getColumn(1).width).toBeGreaterThanOrEqual(34);
    expect(summary?.getCell("A2").value).toBe("PREMISES");

    const monthly = workbook.getWorksheet("Monthly Gross Cash Flow Matrix");
    expect(monthly?.getCell(1, 1).value).toBe("Month #");
    expect(monthly?.getCell(1, 2).value).toBe("Date");
  });
});
