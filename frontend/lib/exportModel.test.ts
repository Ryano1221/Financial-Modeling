/**
 * Regression tests: Summary Matrix row labels and Template Version must not drift.
 * Workbook from canonical fixture must have exact sheet names and key cell labels.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  SUMMARY_MATRIX_ROW_LABELS,
  TEMPLATE_VERSION,
  buildBrokerWorkbook,
} from "./exportModel";
import type { LeaseScenarioCanonical } from "./lease-engine/canonical-schema";

const EXPECTED_ROW_LABELS = [
  "Building name",
  "Suite name",
  "RSF",
  "Lease type",
  "Term (months)",
  "Commencement",
  "Expiration",
  "Base rent ($/RSF/yr)",
  "Avg gross rent/month",
  "Avg all-in cost/month",
  "Avg all-in cost/year",
  "Avg cost/RSF/year",
  "NPV @ discount rate",
  "Total obligation",
  "Equalized avg cost/RSF/yr",
  "Discount rate used",
  "Notes",
];

describe("exportModel", () => {
  it("SUMMARY_MATRIX_ROW_LABELS order and labels never change", () => {
    expect(SUMMARY_MATRIX_ROW_LABELS).toHaveLength(EXPECTED_ROW_LABELS.length);
    EXPECTED_ROW_LABELS.forEach((label, i) => {
      expect(SUMMARY_MATRIX_ROW_LABELS[i]).toBe(label);
    });
  });

  it("TEMPLATE_VERSION is set", () => {
    expect(TEMPLATE_VERSION).toBe("1.0");
  });

  it("buildBrokerWorkbook produces Summary Matrix with Template Version and sheet names", async () => {
    const minimalScenario: LeaseScenarioCanonical = {
      id: "fixture-1",
      name: "Fixture Option",
      discountRateAnnual: 0.08,
      partyAndPremises: {
        premisesName: "Suite 100",
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
        annualEscalationPercent: 0,
        abatement: undefined,
      },
      expenseSchedule: {
        leaseType: "nnn",
        baseOpexPsfYr: 10,
        annualEscalationPercent: 0.03,
      },
      parkingSchedule: { slots: [], annualEscalationPercent: 0 },
      tiSchedule: {
        budgetTotal: 150000,
        allowanceFromLandlord: 150000,
        outOfPocket: 0,
        amortizeOop: false,
      },
      otherCashFlows: { oneTimeCosts: [], brokerFee: 0, securityDepositMonths: 0 },
    };

    const buffer = await buildBrokerWorkbook([minimalScenario], 0.08);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);

    const summarySheet = wb.getWorksheet("Summary Matrix");
    expect(summarySheet).toBeDefined();
    expect(summarySheet?.getCell(1, 1).value).toBe("Template Version");
    expect(summarySheet?.getCell(1, 2).value).toBe(TEMPLATE_VERSION);
    expect(summarySheet?.getCell(2, 1).value).toBe("Metric");

    const firstOptionSheet = wb.getWorksheet("Fixture Option");
    expect(firstOptionSheet).toBeDefined();
    expect(firstOptionSheet?.getCell(1, 1).value).toBe("SECTION A — Inputs");

    let foundSectionB = false;
    let foundMonthlyHeaders = false;
    firstOptionSheet?.eachRow((row, rowNumber) => {
      const a1 = row.getCell(1).value?.toString() ?? "";
      if (a1 === "SECTION B — Monthly Cash Flow Table") foundSectionB = true;
      if (rowNumber > 1 && row.getCell(1).value === "Month" && row.getCell(2).value === "Date") foundMonthlyHeaders = true;
    });
    expect(foundSectionB).toBe(true);
    expect(foundMonthlyHeaders).toBe(true);

    const hiddenSheet = wb.getWorksheet("Fixture Option_Monthly");
    expect(hiddenSheet).toBeDefined();
    expect(hiddenSheet?.state).toBe("hidden");
  });
});
