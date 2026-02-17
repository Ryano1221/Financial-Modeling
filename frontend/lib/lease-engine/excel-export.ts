/**
 * Excel export: Summary comparison matrix + one sheet per option (inputs + outputs).
 * Classic broker workbook feel.
 */

import ExcelJS from "exceljs";
import {
  formatCurrency,
  formatCurrencyPerSF,
  formatDateISO,
  formatMonths,
  formatNumber,
  formatPercent,
  formatRSF,
} from "@/lib/format";
import type { LeaseScenarioCanonical } from "./canonical-schema";
import type { EngineResult, OptionMetrics } from "./monthly-engine";
import { runMonthlyEngine } from "./monthly-engine";

const SUMMARY_SHEET = "Summary";
export const METRIC_LABELS: (keyof OptionMetrics)[] = [
  "premisesName",
  "rsf",
  "leaseType",
  "termMonths",
  "commencementDate",
  "expirationDate",
  "baseRentPsfYr",
  "escalationPercent",
  "opexPsfYr",
  "opexEscalationPercent",
  "parkingCostAnnual",
  "tiBudget",
  "tiAllowance",
  "tiOutOfPocket",
  "grossTiOutOfPocket",
  "avgGrossRentPerMonth",
  "avgGrossRentPerYear",
  "avgAllInCostPerMonth",
  "avgAllInCostPerYear",
  "avgCostPsfYr",
  "npvAtDiscount",
  "discountRateUsed",
  "totalObligation",
  "equalizedAvgCostPsfYr",
  "notes",
];

export const METRIC_DISPLAY_NAMES: Record<string, string> = {
  premisesName: "Premises name",
  rsf: "Rentable square footage",
  leaseType: "Lease type",
  termMonths: "Lease term (months)",
  commencementDate: "Lease commencement date",
  expirationDate: "Lease expiration date",
  baseRentPsfYr: "Base rent ($/RSF/yr)",
  escalationPercent: "Rent escalation %",
  opexPsfYr: "Operating expenses ($/RSF/yr)",
  opexEscalationPercent: "OpEx escalation %",
  parkingCostAnnual: "Parking cost (annual)",
  tiBudget: "TI budget",
  tiAllowance: "TI allowance",
  tiOutOfPocket: "TI out of pocket",
  grossTiOutOfPocket: "Gross TI out of pocket",
  avgGrossRentPerMonth: "Avg gross rent/month",
  avgGrossRentPerYear: "Avg gross rent/year",
  avgAllInCostPerMonth: "Avg all-in cost/month",
  avgAllInCostPerYear: "Avg all-in cost/year",
  avgCostPsfYr: "Avg cost/RSF/year",
  npvAtDiscount: "NPV @ discount rate",
  discountRateUsed: "Discount rate used",
  totalObligation: "Total estimated obligation",
  equalizedAvgCostPsfYr: "Equalized avg cost/RSF/yr",
  notes: "Notes",
};

export function formatMetricValue(key: string, value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (key === "discountRateUsed") return formatPercent(value, { decimals: 1 });
    if (key === "escalationPercent" || key === "opexEscalationPercent") return formatPercent(value);
    if (key === "rsf") return formatRSF(value);
    if (key === "termMonths") return formatMonths(value);
if (key === "commencementDate" || key === "expirationDate") return typeof value === "string" ? formatDateISO(value) : String(value ?? "");
  if (key.includes("Psf") || key.includes("psf")) return formatCurrencyPerSF(value);
    if (key.includes("Cost") || key.includes("Rent") || key.includes("Obligation") || key.includes("Npv") || key.includes("Budget") || key.includes("Allowance") || key.includes("Pocket")) return formatCurrency(value);
    return formatNumber(value);
  }
  if (key === "commencementDate" || key === "expirationDate") return formatDateISO(typeof value === "string" ? value : undefined);
  return String(value);
}


export async function buildWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TheCREmodel";
  workbook.created = new Date();

  const results: EngineResult[] = scenarios.map((s) => runMonthlyEngine(s, globalDiscountRate));

  // ---- Summary sheet: matrix ----
  const summarySheet = workbook.addWorksheet(SUMMARY_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  summarySheet.getColumn(1).width = 32;
  const headerFont = { bold: true };
  summarySheet.getCell(1, 1).value = "Metric";
  summarySheet.getCell(1, 1).font = headerFont;
  results.forEach((r, i) => {
    const col = i + 2;
    summarySheet.getColumn(col).width = 18;
    summarySheet.getCell(1, col).value = r.scenarioName;
    summarySheet.getCell(1, col).font = headerFont;
  });
  METRIC_LABELS.forEach((key, rowIndex) => {
    const row = rowIndex + 2;
    summarySheet.getCell(row, 1).value = METRIC_DISPLAY_NAMES[key] ?? key;
    results.forEach((res, colIndex) => {
      const val = res.metrics[key];
      summarySheet.getCell(row, colIndex + 2).value = formatMetricValue(key, val);
    });
  });

  // ---- One sheet per option ----
  for (let idx = 0; idx < scenarios.length; idx++) {
    const scenario = scenarios[idx];
    const result = results[idx];
    const sheetName = scenario.name.replace(/[/\\?*\[\]]/g, "").slice(0, 31) || `Option ${idx + 1}`;
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 2 }] });

    let row = 1;

    // Inputs section header
    sheet.getCell(row, 1).value = "INPUTS";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;

    // General inputs block
    sheet.getCell(row, 1).value = "General inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const generalRows = [
      ["Rentable square footage", scenario.partyAndPremises.rentableSqFt],
      ["Premises label", scenario.partyAndPremises.premisesLabel ?? ""],
      ["Floors/suite", scenario.partyAndPremises.floorsOrSuite ?? ""],
      ["Lease type", scenario.expenseSchedule.leaseType],
      ["Lease term (months)", scenario.datesAndTerm.leaseTermMonths],
      ["Commencement date", scenario.datesAndTerm.commencementDate],
      ["Expiration date", scenario.datesAndTerm.expirationDate],
      ["Base rent ($/RSF/yr)", scenario.rentSchedule.steps[0]?.ratePsfYr ?? ""],
      ["Annual base rent escalation %", scenario.rentSchedule.annualEscalationPercent * 100],
      ["Rent abatement months", scenario.rentSchedule.abatement?.months ?? 0],
    ];
    generalRows.forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // TI inputs block
    sheet.getCell(row, 1).value = "Tenant improvement inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const ti = scenario.tiSchedule;
    [
      ["TI budget", ti.budgetTotal],
      ["TI allowance", ti.allowanceFromLandlord],
      ["TI out of pocket", ti.outOfPocket],
      ["Amortize TI", ti.amortizeOop ? "Yes" : "No"],
      ["Amortization rate", ti.amortizationRateAnnual ?? ""],
      ["Amortization term (months)", ti.amortizationTermMonths ?? ""],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // OpEx block
    sheet.getCell(row, 1).value = "Operating expenses inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    [
      ["Base OpEx ($/RSF/yr)", scenario.expenseSchedule.baseOpexPsfYr],
      ["Annual OpEx escalation %", scenario.expenseSchedule.annualEscalationPercent * 100],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row++;

    // Parking block
    sheet.getCell(row, 1).value = "Parking inputs";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    scenario.parkingSchedule.slots.forEach((slot, i) => {
      sheet.getCell(row, 1).value = `${slot.type} spaces (count)`;
      sheet.getCell(row, 2).value = slot.count;
      row++;
      sheet.getCell(row, 1).value = `${slot.type} cost/space/month`;
      sheet.getCell(row, 2).value = slot.costPerSpacePerMonth;
      row++;
    });
    row++;

    // Key metrics output block
    sheet.getCell(row, 1).value = "OUTPUTS — Key metrics";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const m = result.metrics;
    [
      ["NPV @ discount rate", m.npvAtDiscount],
      ["Discount rate used", formatPercent(m.discountRateUsed, { decimals: 1 })],
      ["Total estimated obligation", m.totalObligation],
      ["Avg cost/RSF/year", m.avgCostPsfYr],
      ["Avg monthly cost", m.avgAllInCostPerMonth],
      ["Avg annual cost", m.avgAllInCostPerYear],
      ["Equalized avg cost/RSF/yr", m.equalizedAvgCostPsfYr],
    ].forEach(([label, val]) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      row++;
    });
    row += 2;

    // Annual cash flow table
    sheet.getCell(row, 1).value = "Annual cash flow schedule";
    sheet.getCell(row, 1).font = { bold: true };
    row++;
    const annualHeaders = ["Lease year", "Period start", "Period end", "Base rent", "OpEx", "Parking", "TI amort", "Misc", "Total", "Effective $/RSF/yr"];
    annualHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
    });
    row++;
    result.annual.forEach((yr) => {
      sheet.getCell(row, 1).value = yr.leaseYear;
      sheet.getCell(row, 2).value = yr.periodStart;
      sheet.getCell(row, 3).value = yr.periodEnd;
      sheet.getCell(row, 4).value = yr.baseRent;
      sheet.getCell(row, 5).value = yr.opex;
      sheet.getCell(row, 6).value = yr.parking;
      sheet.getCell(row, 7).value = yr.tiAmortization;
      sheet.getCell(row, 8).value = yr.misc;
      sheet.getCell(row, 9).value = yr.total;
      sheet.getCell(row, 10).value = yr.effectivePsfYr;
      row++;
    });

    // Hidden monthly sheet (as separate sheet, hidden)
    const monthlySheetName = `${sheetName}_Monthly`;
    const monthlySheet = workbook.addWorksheet(monthlySheetName, { state: "hidden" });
    const monthlyHeaders = ["Month", "Period start", "Period end", "Base rent", "OpEx", "Parking", "TI amort", "Misc", "Total", "Effective $/RSF/yr"];
    monthlyHeaders.forEach((h, c) => {
      monthlySheet.getCell(1, c + 1).value = h;
      monthlySheet.getCell(1, c + 1).font = { bold: true };
    });
    result.monthly.forEach((mo, i) => {
      const r = i + 2;
      monthlySheet.getCell(r, 1).value = mo.monthIndex + 1;
      monthlySheet.getCell(r, 2).value = mo.periodStart;
      monthlySheet.getCell(r, 3).value = mo.periodEnd;
      monthlySheet.getCell(r, 4).value = mo.baseRent;
      monthlySheet.getCell(r, 5).value = mo.opex;
      monthlySheet.getCell(r, 6).value = mo.parking;
      monthlySheet.getCell(r, 7).value = mo.tiAmortization;
      monthlySheet.getCell(r, 8).value = mo.misc;
      monthlySheet.getCell(r, 9).value = mo.total;
      monthlySheet.getCell(r, 10).value = mo.effectivePsfYr;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ExcelJS.Buffer;
}
