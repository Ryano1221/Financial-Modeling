/**
 * Broker-grade Excel export: professional underwriting model format.
 * Sheet 1: Summary Matrix (with Template Version cell)
 * Sheet 2+: Per-scenario with Section A (Inputs), B (Monthly Cash Flow), C (Annual Summary), D (Broker Metrics)
 * Hidden: {Name}_Monthly per option.
 * Formatting: bold headers, currency, percentage, two decimal precision, no raw floats.
 */

import ExcelJS from "exceljs";
import type { LeaseScenarioCanonical } from "@/lib/lease-engine/canonical-schema";
import type { EngineResult, MonthlyRow, AnnualRow } from "@/lib/lease-engine/monthly-engine";
import { runMonthlyEngine } from "@/lib/lease-engine/monthly-engine";
import { buildWorkbook as buildWorkbookLegacy } from "@/lib/lease-engine/excel-export";
import type { CanonicalComputeResponse, CanonicalMetrics } from "@/lib/types";

/** Locked for regression tests: do not change order or labels. */
export const SUMMARY_MATRIX_ROW_LABELS = [
  "Premises name",
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
] as const;

export const TEMPLATE_VERSION = "1.0";

const CURRENCY_FORMAT = '"$"#,##0.00';
const PERCENT_FORMAT = "0.00%";
const NUMBER_FORMAT = "0.00";

function fmtCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}
function fmtPercent(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}
function fmtNumber(val: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

/**
 * Build professional underwriting workbook from canonical scenarios.
 * Uses existing lease-engine; adds Section A/B/C/D structure and formatting.
 */
export async function buildBrokerWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TheCREmodel";
  workbook.created = new Date();

  const results: EngineResult[] = scenarios.map((s) => runMonthlyEngine(s, globalDiscountRate));

  // ---- Sheet 1: Summary Matrix ----
  const summarySheet = workbook.addWorksheet("Summary Matrix", { views: [{ state: "frozen", ySplit: 2 }] });
  summarySheet.getColumn(1).width = 32;
  summarySheet.getCell(1, 1).value = "Template Version";
  summarySheet.getCell(1, 2).value = TEMPLATE_VERSION;
  summarySheet.getCell(2, 1).value = "Metric";
  summarySheet.getCell(2, 1).font = { bold: true };
  results.forEach((r, i) => {
    const col = i + 2;
    summarySheet.getColumn(col).width = 18;
    summarySheet.getCell(2, col).value = r.scenarioName;
    summarySheet.getCell(2, col).font = { bold: true };
  });
  const metricRows: [string, (m: EngineResult["metrics"]) => string | number][] = [
    ["Premises name", (m) => m.premisesName],
    ["RSF", (m) => m.rsf],
    ["Lease type", (m) => m.leaseType],
    ["Term (months)", (m) => m.termMonths],
    ["Commencement", (m) => m.commencementDate],
    ["Expiration", (m) => m.expirationDate],
    ["Base rent ($/RSF/yr)", (m) => fmtNumber(m.baseRentPsfYr)],
    ["Avg gross rent/month", (m) => fmtCurrency(m.avgGrossRentPerMonth)],
    ["Avg all-in cost/month", (m) => fmtCurrency(m.avgAllInCostPerMonth)],
    ["Avg all-in cost/year", (m) => fmtCurrency(m.avgAllInCostPerYear)],
    ["Avg cost/RSF/year", (m) => fmtNumber(m.avgCostPsfYr)],
    ["NPV @ discount rate", (m) => fmtCurrency(m.npvAtDiscount)],
    ["Total obligation", (m) => fmtCurrency(m.totalObligation)],
    ["Equalized avg cost/RSF/yr", (m) => fmtNumber(m.equalizedAvgCostPsfYr)],
    ["Discount rate used", (m) => fmtPercent(m.discountRateUsed)],
    ["Notes", (m) => m.notes],
  ];
  metricRows.forEach(([label, fn], rowIndex) => {
    const row = rowIndex + 3;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    results.forEach((res, colIndex) => {
      const val = fn(res.metrics);
    summarySheet.getCell(row, colIndex + 2).value = typeof val === "number" ? val : String(val);
  });
  });

  // ---- Sheet 2+: Individual scenario sheets ----
  for (let idx = 0; idx < scenarios.length; idx++) {
    const scenario = scenarios[idx];
    const result = results[idx];
    const sheetName = (scenario.name || `Option ${idx + 1}`).replace(/[/\\?*\[\]]/g, "").slice(0, 31) || `Option ${idx + 1}`;
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });

    let row = 1;

    // SECTION A — Inputs
    sheet.getCell(row, 1).value = "SECTION A — Inputs";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const inputRows: [string, string | number][] = [
      ["Premises name", scenario.partyAndPremises?.premisesName ?? ""],
      ["Rentable square footage", scenario.partyAndPremises?.rentableSqFt ?? 0],
      ["Lease type", scenario.expenseSchedule?.leaseType ?? ""],
      ["Lease term (months)", scenario.datesAndTerm?.leaseTermMonths ?? 0],
      ["Commencement date", scenario.datesAndTerm?.commencementDate ?? ""],
      ["Expiration date", scenario.datesAndTerm?.expirationDate ?? ""],
      ["Base rent ($/RSF/yr)", scenario.rentSchedule?.steps?.[0]?.ratePsfYr ?? ""],
      ["Annual base rent escalation %", ((scenario.rentSchedule?.annualEscalationPercent ?? 0) * 100).toFixed(2) + "%"],
      ["Rent abatement months", scenario.rentSchedule?.abatement?.months ?? 0],
      ["Base OpEx ($/RSF/yr)", scenario.expenseSchedule?.baseOpexPsfYr ?? 0],
      ["Annual OpEx escalation %", ((scenario.expenseSchedule?.annualEscalationPercent ?? 0) * 100).toFixed(2) + "%"],
      ["TI budget", scenario.tiSchedule?.budgetTotal ?? 0],
      ["TI allowance", scenario.tiSchedule?.allowanceFromLandlord ?? 0],
      ["TI out of pocket", scenario.tiSchedule?.outOfPocket ?? 0],
      ["Amortize TI", scenario.tiSchedule?.amortizeOop ? "Yes" : "No"],
      ["Parking (annual)", result.metrics.parkingCostAnnual],
    ];
    inputRows.forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      sheet.getCell(row, 2).value = typeof val === "number" ? (Number.isInteger(val) ? val : parseFloat(val.toFixed(2))) : val;
      row++;
    });
    row += 2;

    // SECTION B — Monthly Cash Flow Table
    sheet.getCell(row, 1).value = "SECTION B — Monthly Cash Flow Table";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const monthlyHeaders = ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"];
    monthlyHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    result.monthly.forEach((mo: MonthlyRow) => {
      sheet.getCell(row, 1).value = mo.monthIndex + 1;
      sheet.getCell(row, 2).value = mo.periodStart;
      sheet.getCell(row, 3).value = parseFloat(mo.baseRent.toFixed(2));
      sheet.getCell(row, 4).value = parseFloat(mo.opex.toFixed(2));
      sheet.getCell(row, 5).value = parseFloat(mo.parking.toFixed(2));
      sheet.getCell(row, 6).value = parseFloat(mo.tiAmortization.toFixed(2));
      sheet.getCell(row, 7).value = 0;
      sheet.getCell(row, 8).value = parseFloat(mo.total.toFixed(2));
      sheet.getCell(row, 9).value = parseFloat(mo.cumulativeCost.toFixed(2));
      sheet.getCell(row, 10).value = parseFloat(mo.discountedValue.toFixed(2));
      row++;
    });
    row += 2;

    // SECTION C — Annual Summary
    sheet.getCell(row, 1).value = "SECTION C — Annual Summary";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const annualHeaders = ["Year", "Total Cost", "Avg $/RSF", "Cumulative", "Discounted"];
    annualHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    let cumAnn = 0;
    let discAnn = 0;
    result.annual.forEach((yr: AnnualRow, yi: number) => {
      cumAnn += yr.total;
      const monthlyRate = Math.pow(1 + result.discountRateUsed, 1 / 12) - 1;
      const startM = yi * 12;
      let pv = 0;
      for (let m = 0; m < 12 && startM + m < result.monthly.length; m++) {
        pv += result.monthly[startM + m].total / Math.pow(1 + monthlyRate, startM + m);
      }
      discAnn += pv;
      sheet.getCell(row, 1).value = yr.leaseYear;
      sheet.getCell(row, 2).value = parseFloat(yr.total.toFixed(2));
      sheet.getCell(row, 3).value = result.metrics.rsf > 0 ? parseFloat((yr.total / result.metrics.rsf).toFixed(2)) : 0;
      sheet.getCell(row, 4).value = parseFloat(cumAnn.toFixed(2));
      sheet.getCell(row, 5).value = parseFloat(discAnn.toFixed(2));
      row++;
    });
    row += 2;

    // SECTION D — Broker Metrics
    sheet.getCell(row, 1).value = "SECTION D — Broker Metrics";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const m = result.metrics;
    const brokerRows: [string, string | number][] = [
      ["Total obligation", parseFloat(m.totalObligation.toFixed(2))],
      ["NPV", parseFloat(m.npvAtDiscount.toFixed(2))],
      ["Equalized Avg Cost / RSF / Yr", parseFloat(m.equalizedAvgCostPsfYr.toFixed(2))],
      ["Effective rent (avg gross/month)", parseFloat(m.avgGrossRentPerMonth.toFixed(2))],
      ["TI value (allowance)", parseFloat(m.tiAllowance.toFixed(2))],
      ["Free rent value", scenario.rentSchedule?.abatement ? "See abatement" : 0],
      ["Parking total (nominal)", parseFloat(m.parkingCostAnnual.toFixed(2))],
    ];
    brokerRows.forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      sheet.getCell(row, 2).value = val;
      row++;
    });

    // Hidden monthly sheet (source of truth)
    const monthlySheetName = `${sheetName}_Monthly`;
    const monthlySheet = workbook.addWorksheet(monthlySheetName, { state: "hidden" });
    ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"].forEach((h, c) => {
      monthlySheet.getCell(1, c + 1).value = h;
      monthlySheet.getCell(1, c + 1).font = { bold: true };
    });
    result.monthly.forEach((mo: MonthlyRow, i: number) => {
      const r = i + 2;
      monthlySheet.getCell(r, 1).value = mo.monthIndex + 1;
      monthlySheet.getCell(r, 2).value = mo.periodStart;
      monthlySheet.getCell(r, 3).value = mo.baseRent;
      monthlySheet.getCell(r, 4).value = mo.opex;
      monthlySheet.getCell(r, 5).value = mo.parking;
      monthlySheet.getCell(r, 6).value = mo.tiAmortization;
      monthlySheet.getCell(r, 7).value = 0;
      monthlySheet.getCell(r, 8).value = mo.total;
      monthlySheet.getCell(r, 9).value = mo.cumulativeCost;
      monthlySheet.getCell(r, 10).value = mo.discountedValue;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ExcelJS.Buffer;
}

/**
 * Build broker workbook from backend CanonicalComputeResponse (production path).
 * Uses Summary Matrix + Section A/B/C/D + hidden monthly from response.
 */
export async function buildBrokerWorkbookFromCanonicalResponses(
  items: { response: CanonicalComputeResponse; scenarioName: string }[]
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TheCREmodel";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary Matrix", { views: [{ state: "frozen", ySplit: 2 }] });
  summarySheet.getColumn(1).width = 32;
  summarySheet.getCell(1, 1).value = "Template Version";
  summarySheet.getCell(1, 2).value = TEMPLATE_VERSION;
  summarySheet.getCell(2, 1).value = "Metric";
  summarySheet.getCell(2, 1).font = { bold: true };
  items.forEach((item, i) => {
    const col = i + 2;
    summarySheet.getColumn(col).width = 18;
    summarySheet.getCell(2, col).value = item.scenarioName;
    summarySheet.getCell(2, col).font = { bold: true };
  });
  const metricLabels = SUMMARY_MATRIX_ROW_LABELS;
  const getMetricVal = (m: CanonicalMetrics, rowIndex: number): string | number => {
    switch (rowIndex) {
      case 0: return m.premises_name ?? "";
      case 1: return m.rsf ?? 0;
      case 2: return m.lease_type ?? "";
      case 3: return m.term_months ?? 0;
      case 4: return m.commencement_date ?? "";
      case 5: return m.expiration_date ?? "";
      case 6: return m.base_rent_avg_psf_year ?? 0;
      case 7: return (m.base_rent_total ?? 0) / 12;
      case 8: return (m.total_obligation_nominal ?? 0) / Math.max(1, m.term_months ?? 1);
      case 9: return (m.total_obligation_nominal ?? 0) / (Math.max(1, m.term_months ?? 1) / 12);
      case 10: return m.avg_all_in_cost_psf_year ?? 0;
      case 11: return m.npv_cost ?? 0;
      case 12: return m.total_obligation_nominal ?? 0;
      case 13: return m.equalized_avg_cost_psf_year ?? 0;
      case 14: return m.discount_rate_annual ?? 0.08;
      case 15: return m.notes ?? "";
      default: return "";
    }
  };
  metricLabels.forEach((label, rowIndex) => {
    const row = rowIndex + 3;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    items.forEach((item, colIndex) => {
      const val = getMetricVal(item.response.metrics, rowIndex);
      const out = typeof val === "number"
        ? (rowIndex === 14 ? fmtPercent(val) : [1, 3, 6, 10, 13].includes(rowIndex) ? fmtNumber(val) : fmtCurrency(val))
        : String(val);
      summarySheet.getCell(row, colIndex + 2).value = out;
    });
  });

  for (let idx = 0; idx < items.length; idx++) {
    const { response, scenarioName } = items[idx];
    const c = response.normalized_canonical_lease;
    const m = response.metrics;
    const sheetName = (scenarioName || `Option ${idx + 1}`).replace(/[/\\?*\[\]]/g, "").slice(0, 31) || `Option ${idx + 1}`;
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });
    let row = 1;
    sheet.getCell(row, 1).value = "SECTION A — Inputs";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const inputRows: [string, string | number][] = [
      ["Premises name", m.premises_name ?? ""],
      ["Rentable square footage", m.rsf ?? 0],
      ["Lease type", m.lease_type ?? ""],
      ["Lease term (months)", m.term_months ?? 0],
      ["Commencement date", m.commencement_date ?? ""],
      ["Expiration date", m.expiration_date ?? ""],
      ["Base rent ($/RSF/yr)", m.base_rent_avg_psf_year ?? 0],
      ["Base OpEx ($/RSF/yr)", m.opex_avg_psf_year ?? 0],
      ["TI allowance", m.ti_value_total ?? 0],
      ["Parking (annual)", m.parking_total ?? 0],
      ["Total obligation", m.total_obligation_nominal ?? 0],
      ["NPV", m.npv_cost ?? 0],
    ];
    inputRows.forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      sheet.getCell(row, 2).value = typeof val === "number" ? val : val;
      row++;
    });
    row += 2;
    sheet.getCell(row, 1).value = "SECTION B — Monthly Cash Flow Table";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"].forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    response.monthly_rows.forEach((mo) => {
      sheet.getCell(row, 1).value = mo.month_index + 1;
      sheet.getCell(row, 2).value = mo.date;
      sheet.getCell(row, 3).value = mo.base_rent;
      sheet.getCell(row, 4).value = mo.opex;
      sheet.getCell(row, 5).value = mo.parking;
      sheet.getCell(row, 6).value = mo.ti_amort;
      sheet.getCell(row, 7).value = mo.concessions;
      sheet.getCell(row, 8).value = mo.total_cost;
      sheet.getCell(row, 9).value = mo.cumulative_cost;
      sheet.getCell(row, 10).value = mo.discounted_value;
      row++;
    });
    row += 2;
    sheet.getCell(row, 1).value = "SECTION C — Annual Summary";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    ["Year", "Total Cost", "Avg $/RSF", "Cumulative", "Discounted"].forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    response.annual_rows.forEach((yr) => {
      sheet.getCell(row, 1).value = yr.year_index + 1;
      sheet.getCell(row, 2).value = yr.total_cost;
      sheet.getCell(row, 3).value = yr.avg_cost_psf_year;
      sheet.getCell(row, 4).value = yr.cumulative_cost;
      sheet.getCell(row, 5).value = yr.discounted_value;
      row++;
    });
    row += 2;
    sheet.getCell(row, 1).value = "SECTION D — Broker Metrics";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    [
      ["Total obligation", m.total_obligation_nominal],
      ["NPV", m.npv_cost],
      ["Equalized Avg Cost / RSF / Yr", m.equalized_avg_cost_psf_year],
      ["TI value (allowance)", m.ti_value_total],
      ["Parking total", m.parking_total],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      sheet.getCell(row, 2).value = typeof val === "number" ? val : "";
      row++;
    });
    const monthlySheetName = `${sheetName}_Monthly`;
    const monthlySheet = workbook.addWorksheet(monthlySheetName, { state: "hidden" });
    ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"].forEach((h, c) => {
      monthlySheet.getCell(1, c + 1).value = h;
      monthlySheet.getCell(1, c + 1).font = { bold: true };
    });
    response.monthly_rows.forEach((mo, i) => {
      const r = i + 2;
      monthlySheet.getCell(r, 1).value = mo.month_index + 1;
      monthlySheet.getCell(r, 2).value = mo.date;
      monthlySheet.getCell(r, 3).value = mo.base_rent;
      monthlySheet.getCell(r, 4).value = mo.opex;
      monthlySheet.getCell(r, 5).value = mo.parking;
      monthlySheet.getCell(r, 6).value = mo.ti_amort;
      monthlySheet.getCell(r, 7).value = mo.concessions;
      monthlySheet.getCell(r, 8).value = mo.total_cost;
      monthlySheet.getCell(r, 9).value = mo.cumulative_cost;
      monthlySheet.getCell(r, 10).value = mo.discounted_value;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ExcelJS.Buffer;
}

/**
 * Export workbook (alias: use broker format).
 * Delegates to buildBrokerWorkbook for broker-grade output.
 */
export async function buildWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  return buildBrokerWorkbook(scenarios, globalDiscountRate);
}

export { buildWorkbookLegacy };
