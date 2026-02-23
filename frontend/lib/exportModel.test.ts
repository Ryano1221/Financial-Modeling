import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  SUMMARY_MATRIX_ROW_LABELS,
  TEMPLATE_VERSION,
  buildBrokerWorkbook,
} from "./exportModel";
import type { LeaseScenarioCanonical } from "./lease-engine/canonical-schema";
import { CRE_DEFAULT_LOGO_DATA_URL } from "./default-brokerage-logo-data-url";

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

function findCellAnywhere(
  sheet: ExcelJS.Worksheet | undefined,
  needle: string
): { row: number; col: number } | null {
  if (!sheet) return null;
  let found: { row: number; col: number } | null = null;
  sheet.eachRow((row, rowNumber) => {
    if (found != null) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (found != null) return;
      const val = cell.value;
      if (typeof val === "string" && val.trim() === needle) {
        found = { row: rowNumber, col: colNumber };
      }
    });
  });
  return found;
}

describe("exportModel institutional workbook", () => {
  it("exposes required summary labels", () => {
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("Building name");
    expect(SUMMARY_MATRIX_ROW_LABELS).toContain("NPV cost");
    expect(SUMMARY_MATRIX_ROW_LABELS).not.toContain("Notes");
  });

  it("template version is defined", () => {
    expect(TEMPLATE_VERSION).toBe("3.0");
  });

  it("builds required workbook sheets and branded headers", async () => {
    const baseScenario: LeaseScenarioCanonical = {
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
    const scenarios: LeaseScenarioCanonical[] = Array.from({ length: 4 }, (_, idx) => ({
      ...baseScenario,
      id: `fixture-${idx + 1}`,
      name: `Fixture Option ${idx + 1}`,
      partyAndPremises: {
        ...baseScenario.partyAndPremises,
        premisesLabel: `Main Tower ${idx + 1}`,
        floorsOrSuite: `Suite ${100 + idx}`,
        rentableSqFt: 5000 + idx * 250,
      },
    }));

    const buffer = await buildBrokerWorkbook(scenarios, 0.08, {
      brokerageName: "Anchor Capital",
      clientName: "Client A",
      reportDate: "2026-02-22",
      preparedBy: "Analyst",
      clientLogoDataUrl: CRE_DEFAULT_LOGO_DATA_URL,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as ArrayBuffer);

    expect(workbook.getWorksheet("Cover")).toBeDefined();
    expect(workbook.getWorksheet("Summary Comparison")).toBeDefined();
    expect(workbook.getWorksheet("Equalized Metrics")).toBeDefined();
    expect(workbook.getWorksheet("Monthly Gross Cash Flow Matrix")).toBeDefined();
    expect(workbook.worksheets.some((sheet) => sheet.name.startsWith("Appendix"))).toBe(true);

    workbook.worksheets.forEach((ws) => {
      const primaryView = ws.views?.[0] as (ExcelJS.WorksheetView & { style?: string }) | undefined;
      expect(primaryView?.style).toBe("pageBreakPreview");
      expect(ws.pageSetup.fitToWidth).toBe(1);
      if (ws.name === "Summary Comparison" || ws.name === "Cover") {
        expect(ws.pageSetup.fitToHeight).toBe(1);
      } else {
        expect(ws.pageSetup.fitToHeight).toBe(0);
      }
      expect(ws.getImages().length).toBeGreaterThan(0);
    });

    const cover = workbook.getWorksheet("Cover");
    expect((cover?.getCell("A1").value as string) ?? "").toContain("THE COMMERCIAL REAL ESTATE MODEL");
    const snapshotRow = findRowByFirstCell(cover, "SCENARIO SNAPSHOT");
    expect(snapshotRow).not.toBeNull();
    const keyMetricsRow = findRowByFirstCell(cover, "KEY FINANCIAL METRICS");
    expect(keyMetricsRow).toBeNull();
    const eqTotalHeader = findCellAnywhere(cover, "Equalized Total Obligation");
    const avgPsfHeader = findCellAnywhere(cover, "Average Price / SF");
    const eqPsfHeader = findCellAnywhere(cover, "Equalized Price / SF");
    expect(eqTotalHeader).not.toBeNull();
    expect(avgPsfHeader).not.toBeNull();
    expect(eqPsfHeader).not.toBeNull();

    const summary = workbook.getWorksheet("Summary Comparison");
    const metricRow = findRowByFirstCell(summary, "Metric");
    expect(metricRow).not.toBeNull();
    expect(summary?.getColumn(1).width).toBeGreaterThanOrEqual(28);
    const premisesRow = findRowByFirstCell(summary, "PREMISES");
    expect(premisesRow).not.toBeNull();
    if (summary && metricRow != null) {
      const headerVals = [2, 3, 4, 5].map((col) => summary.getCell(metricRow, col).value);
      expect(headerVals.filter(Boolean).length).toBe(4);
      expect(summary.getCell(metricRow, 6).value).toBeNull();
      const notesMetricRow = findRowByCellValue(summary, 1, "Notes");
      expect(notesMetricRow).toBeNull();
      const notesHintRow = findRowByFirstCell(summary, "Notes are listed in full on the Notes sheet.");
      expect(notesHintRow).not.toBeNull();
      if (notesHintRow != null) expect(summary.pageSetup.printArea).toBe(`A1:E${notesHintRow}`);
      expect(summary.pageSetup.horizontalCentered).toBe(true);

      const images = summary.getImages();
      const maxImageTlCol = images.reduce((max, img) => {
        const range = img.range as unknown as { tl?: { col?: number } };
        const tlCol = range?.tl?.col ?? 0;
        return Math.max(max, tlCol);
      }, 0);
      // last scenario block starts at column E (zero-index 4) for 4 scenarios.
      expect(Math.floor(maxImageTlCol)).toBe(4);
    }

    const equalized = workbook.getWorksheet("Equalized Metrics");
    if (equalized) {
      const maxImageTlCol = equalized.getImages().reduce((max, img) => {
        const range = img.range as unknown as { tl?: { col?: number } };
        return Math.max(max, range?.tl?.col ?? 0);
      }, 0);
      // scenario start col=2, N=4 => last_left_col=5 => zero-index 4
      expect(Math.floor(maxImageTlCol)).toBe(4);
    }

    const monthly = workbook.getWorksheet("Monthly Gross Cash Flow Matrix");
    const monthHeaderRow = findRowByFirstCell(monthly, "Month #");
    expect(monthHeaderRow).not.toBeNull();
    if (monthHeaderRow != null && monthly) {
      expect(monthly.getCell(monthHeaderRow, 2).value).toBe("Date");

      const month0Row = monthHeaderRow + 1;
      expect(monthly.getCell(month0Row, 1).value).toBe(0);
      expect(monthly.getCell(month0Row, 2).value).toBe("PRE LEASE COMMENCEMENT");

      const totalRow = findRowByCellValue(monthly, 2, "Total Estimated Obligation");
      expect(totalRow).not.toBeNull();
      if (totalRow != null) {
        const formulaCell = monthly.getCell(totalRow, 3).value as ExcelJS.CellFormulaValue;
        expect(formulaCell).toHaveProperty("formula");
        expect(formulaCell.formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
      }
      const maxImageTlCol = monthly.getImages().reduce((max, img) => {
        const range = img.range as unknown as { tl?: { col?: number } };
        return Math.max(max, range?.tl?.col ?? 0);
      }, 0);
      // scenario start col=3, N=4 => last_left_col=6 => zero-index 5
      expect(Math.floor(maxImageTlCol)).toBe(5);
    }

    const notesSheet = workbook.getWorksheet("Notes");
    expect(notesSheet).toBeDefined();
    if (notesSheet) {
      const firstBulletRow = findRowByCellValue(notesSheet, 1, "•");
      expect(firstBulletRow).not.toBeNull();
      if (firstBulletRow != null) {
        expect(notesSheet.getCell(firstBulletRow, 2).alignment?.wrapText).toBe(true);
      }
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
