import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  SUMMARY_MATRIX_ROW_LABELS,
  TEMPLATE_VERSION,
  buildBrokerWorkbook,
} from "./exportModel";
import type { LeaseScenarioCanonical } from "./lease-engine/canonical-schema";

function findRowByFirstCell(sheet: ExcelJS.Worksheet | undefined, needle: string): number | null {
  if (!sheet) return null;
  let found: number | null = null;
  sheet.eachRow((row, rowNumber) => {
    if (found != null) return;
    const val = row.getCell(1).value;
    if (typeof val === "string" && val.trim() === needle) {
      found = rowNumber;
    }
  });
  return found;
}

function findRowByCellValue(
  sheet: ExcelJS.Worksheet | undefined,
  col: number,
  needle: string
): number | null {
  if (!sheet) return null;
  let found: number | null = null;
  sheet.eachRow((row, rowNumber) => {
    if (found != null) return;
    const val = row.getCell(col).value;
    if (typeof val === "string" && val.trim() === needle) {
      found = rowNumber;
    }
  });
  return found;
}

describe("exportModel institutional workbook", () => {
  it("exposes required summary labels", () => {
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("Building name");
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("NPV cost");
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("Notes");
  });

  it("template version is defined", () => {
    expect(TEMPLATE_VERSION).toBe("3.0");
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
      notes:
        "Renewal option available with long explanatory language for wrapping checks. " +
        "ROFR exists. Parking ratio applies. Operating expense exclusions include controllable costs.",
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
    const metricRow = findRowByFirstCell(summary, "Metric");
    expect(metricRow).not.toBeNull();
    expect(summary?.getColumn(1).width).toBeGreaterThanOrEqual(28);
    const premisesRow = findRowByFirstCell(summary, "PREMISES");
    expect(premisesRow).not.toBeNull();

    const monthly = workbook.getWorksheet("Monthly Gross Cash Flow Matrix");
    const monthHeaderRow = findRowByFirstCell(monthly, "Month #");
    expect(monthHeaderRow).not.toBeNull();
    if (monthHeaderRow != null && monthly) {
      expect(monthly.getCell(monthHeaderRow, 2).value).toBe("Date");

      const month0Row = monthHeaderRow + 1;
      expect(monthly.getCell(month0Row, 1).value).toBe(0);
      expect(monthly.getCell(month0Row, 2).value).toBe("PRE COMMENCEMENT");

      const totalRow = findRowByCellValue(monthly, 2, "Total Estimated Obligation");
      expect(totalRow).not.toBeNull();
      if (totalRow != null) {
        const formulaCell = monthly.getCell(totalRow, 3).value as ExcelJS.CellFormulaValue;
        expect(formulaCell).toHaveProperty("formula");
        expect(formulaCell.formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
      }
    }

    const notesRow = findRowByCellValue(summary, 1, "Notes");
    expect(notesRow).not.toBeNull();
    if (summary && notesRow != null) {
      const noteCell = summary.getCell(notesRow, 3);
      expect(noteCell.alignment?.wrapText).toBe(true);
      expect((summary.getRow(notesRow).height ?? 0)).toBeGreaterThanOrEqual(20);
      expect(noteCell.value).toBe("See Notes sheet");
    }

    const appendix = workbook.worksheets.find((sheet) => sheet.name.startsWith("Appendix"));
    expect(appendix).toBeDefined();
    const appendixTotalsRow = findRowByCellValue(appendix, 2, "Totals");
    expect(appendixTotalsRow).not.toBeNull();
    if (appendix && appendixTotalsRow != null) {
      const grossTotal = appendix.getCell(appendixTotalsRow, 7).value as ExcelJS.CellFormulaValue;
      expect(grossTotal).toHaveProperty("formula");
      expect(grossTotal.formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
    }
  });
});
