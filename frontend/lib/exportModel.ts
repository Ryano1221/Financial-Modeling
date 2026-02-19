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
  "Building name",
  "Suite / floor",
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
const INTEGER_FORMAT = "#,##0";

type ValueFormat = "text" | "integer" | "number" | "currency" | "currency_psf" | "percent" | "date";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};

const SUBHEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE5E7EB" },
};

const LABEL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF3F4F6" },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};

const NOTE_CATEGORY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "Renewal / extension", regex: /\brenew(al)?\b|\bextend\b/i },
  { label: "ROFR / ROFO", regex: /\brofr\b|\brofo\b|right of first refusal|right of first offer/i },
  { label: "Expansion / contraction", regex: /\bexpansion\b|\bcontraction\b|\bgive[- ]?back\b/i },
  { label: "Termination", regex: /\btermination\b|\bearly termination\b/i },
  { label: "Assignment / sublease", regex: /\bassignment\b|\bsublease\b/i },
  { label: "Operating expenses", regex: /\bopex\b|\boperating expense\b|\bexpense stop\b|\bbase year\b/i },
  { label: "Expense caps / exclusions", regex: /\bcap\b|\bexcluded\b|\bexclusion\b|\bcontrollable\b/i },
  { label: "Parking", regex: /\bparking\b|\bspace(s)?\b|\bratio\b/i },
  { label: "Use / restrictions", regex: /\bpermitted use\b|\buse restriction\b|\bexclusive use\b|\buse shall be\b/i },
  { label: "Holdover", regex: /\bholdover\b/i },
];

function safeDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function canonicalSuiteOrFloor(suite?: string | null, floor?: string | null): string {
  const su = (suite ?? "").trim();
  if (su) return su;
  const fl = (floor ?? "").trim();
  return fl ? `Floor ${fl}` : "";
}

function splitNoteFragments(raw: string): string[] {
  const text = (raw || "").replace(/\r/g, "\n").replace(/\u2022/g, "\n").trim();
  if (!text) return [];
  const normalized = text.replace(/\n{2,}/g, "\n");
  const primary = normalized
    .split(/\s*\|\s*|\n+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (primary.length > 1) return primary;
  return normalized
    .split(/\.\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyNoteCategory(detail: string): string {
  for (const pattern of NOTE_CATEGORY_PATTERNS) {
    if (pattern.regex.test(detail)) return pattern.label;
  }
  return "General";
}

function buildCategorizedNoteSummary(rawNotes: string): string {
  const fragments = splitNoteFragments(rawNotes);
  if (fragments.length === 0) return "";
  const grouped = new Map<string, string[]>();
  for (const fragment of fragments) {
    const category = classifyNoteCategory(fragment);
    const existing = grouped.get(category) ?? [];
    const compact = fragment.replace(/\s+/g, " ").trim();
    if (!existing.some((item) => item.toLowerCase() === compact.toLowerCase())) {
      existing.push(compact);
      grouped.set(category, existing);
    }
  }
  return Array.from(grouped.entries())
    .map(([category, details]) => `${category}: ${details.join(" | ")}`)
    .join("\n");
}

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[/\\?*\[\]]/g, "").trim();
  const base = cleaned || fallback;
  return base.slice(0, 31).trim() || fallback.slice(0, 31);
}

function makeUniqueSheetName(name: string, fallback: string, used: Set<string>): string {
  const base = sanitizeSheetName(name, fallback);
  let attempt = 1;
  while (attempt <= 9999) {
    const suffix = attempt === 1 ? "" : ` (${attempt})`;
    const trimmedBase = base.slice(0, Math.max(1, 31 - suffix.length)).trim();
    const candidate = `${trimmedBase}${suffix}`;
    const key = candidate.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    attempt += 1;
  }
  const emergency = `${Date.now()}`.slice(-6);
  const fallbackName = sanitizeSheetName(`${fallback}-${emergency}`, fallback);
  used.add(fallbackName.toLowerCase());
  return fallbackName;
}

function applyValueFormat(cell: ExcelJS.Cell, format: ValueFormat): void {
  if (format === "currency") {
    cell.numFmt = CURRENCY_FORMAT;
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "currency_psf") {
    cell.numFmt = CURRENCY_FORMAT;
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "percent") {
    cell.numFmt = PERCENT_FORMAT;
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "integer") {
    cell.numFmt = INTEGER_FORMAT;
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "number") {
    cell.numFmt = NUMBER_FORMAT;
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "date") {
    cell.alignment = { horizontal: "right" };
  }
}

function extractClauseHighlights(rawNotes: string): Array<{ category: string; detail: string }> {
  const parts = splitNoteFragments(rawNotes);
  if (parts.length === 0) return [];
  const rows: Array<{ category: string; detail: string }> = [];
  for (const part of parts) {
    rows.push({ category: classifyNoteCategory(part), detail: part });
  }
  if (rows.length > 0) return rows;
  return [{ category: "General", detail: (rawNotes || "").trim() }];
}

function styleSummaryMatrixGrid(sheet: ExcelJS.Worksheet, rows: number, cols: number): void {
  for (let c = 1; c <= cols; c++) {
    for (let r = 1; r <= rows; r++) {
      const cell = sheet.getCell(r, c);
      cell.border = THIN_BORDER;
      if (r === 2) {
        cell.fill = HEADER_FILL;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      } else if (c === 1 && r >= 3) {
        cell.fill = LABEL_FILL;
        cell.font = { bold: true, color: { argb: "FF111827" } };
      } else if (r % 2 === 1 && r >= 3) {
        cell.fill = SUBHEADER_FILL;
      }
    }
  }
  sheet.getCell(1, 1).font = { bold: true };
  sheet.getCell(1, 2).font = { bold: true };
}

function styleWrappedNotesRow(sheet: ExcelJS.Worksheet, row: number, cols: number): void {
  if (row <= 0) return;
  const notesRow = sheet.getRow(row);
  notesRow.height = 90;
  for (let col = 2; col <= cols; col++) {
    const cell = sheet.getCell(row, col);
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  }
}

function addMonthlyComparisonSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  rowsByScenario: Array<{ name: string; rows: Array<{ monthIndex: number; date: string; totalCost: number }> }>
): void {
  if (rowsByScenario.length === 0) return;
  const sheetName = makeUniqueSheetName("Monthly Comparison", "Monthly Comparison", usedSheetNames);
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 2, xSplit: 2 }] });
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 14;
  sheet.mergeCells(1, 1, 2, 1);
  sheet.mergeCells(1, 2, 2, 2);
  sheet.getCell(1, 1).value = "Month";
  sheet.getCell(1, 2).value = "Date";
  sheet.getCell(1, 1).font = { bold: true };
  sheet.getCell(1, 2).font = { bold: true };
  sheet.getCell(1, 1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getCell(1, 2).alignment = { vertical: "middle", horizontal: "center" };

  rowsByScenario.forEach((scenario, i) => {
    const col = 3 + i * 2;
    sheet.getColumn(col).width = 18;
    sheet.getColumn(col + 1).width = 18;
    sheet.mergeCells(1, col, 1, col + 1);
    sheet.getCell(1, col).value = scenario.name;
    sheet.getCell(2, col).value = "Monthly cost";
    sheet.getCell(2, col + 1).value = "Annualized";
    sheet.getCell(1, col).font = { bold: true };
    sheet.getCell(2, col).font = { bold: true };
    sheet.getCell(2, col + 1).font = { bold: true };
    sheet.getCell(1, col).alignment = { horizontal: "center" };
  });

  const maxMonths = rowsByScenario.reduce((max, s) => Math.max(max, s.rows.length), 0);
  for (let m = 0; m < maxMonths; m++) {
    const row = m + 3;
    sheet.getCell(row, 1).value = m + 1;
    const firstDate = rowsByScenario.find((s) => s.rows[m])?.rows[m]?.date ?? "";
    sheet.getCell(row, 2).value = firstDate;
    rowsByScenario.forEach((scenario, i) => {
      const src = scenario.rows[m];
      if (!src) return;
      const col = 3 + i * 2;
      sheet.getCell(row, col).value = src.totalCost;
      sheet.getCell(row, col + 1).value = src.totalCost * 12;
      sheet.getCell(row, col).numFmt = CURRENCY_FORMAT;
      sheet.getCell(row, col + 1).numFmt = CURRENCY_FORMAT;
      sheet.getCell(row, col).alignment = { horizontal: "right" };
      sheet.getCell(row, col + 1).alignment = { horizontal: "right" };
    });
  }

  const totalCols = 2 + rowsByScenario.length * 2;
  for (let c = 1; c <= totalCols; c++) {
    for (let r = 1; r <= maxMonths + 2; r++) {
      const cell = sheet.getCell(r, c);
      cell.border = THIN_BORDER;
      if (r <= 2) {
        cell.fill = HEADER_FILL;
        cell.font = { ...(cell.font ?? {}), bold: true, color: { argb: "FFFFFFFF" } };
      }
    }
  }
}

function addNotesAndClausesSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  rows: Array<{ scenario: string; sourceLabel: string; text: string }>
): void {
  const sheetName = makeUniqueSheetName("Notes & Clauses", "Notes & Clauses", usedSheetNames);
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Scenario", key: "scenario", width: 28 },
    { header: "Category", key: "category", width: 22 },
    { header: "Detail", key: "detail", width: 120 },
    { header: "Source", key: "source", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = HEADER_FILL;

  for (const row of rows) {
    const highlights = extractClauseHighlights(row.text);
    if (highlights.length === 0) {
      sheet.addRow({
        scenario: row.scenario,
        category: "No clause extracted",
        detail: "No notable clauses detected. Review source lease language directly for ROFR/ROFO/renewal and OpEx exclusions.",
        source: row.sourceLabel,
      });
      continue;
    }
    for (const highlight of highlights) {
      sheet.addRow({
        scenario: row.scenario,
        category: highlight.category,
        detail: highlight.detail,
        source: row.sourceLabel,
      });
    }
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = SUBHEADER_FILL;
    }
    row.eachCell((cell) => {
      cell.border = THIN_BORDER;
      if (rowNumber > 1) {
        cell.alignment = { vertical: "top", wrapText: true };
      }
    });
  });
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
  const usedSheetNames = new Set<string>();

  const results: EngineResult[] = scenarios.map((s) => runMonthlyEngine(s, globalDiscountRate));

  // ---- Sheet 1: Summary Matrix ----
  const summarySheet = workbook.addWorksheet(
    makeUniqueSheetName("Summary Matrix", "Summary Matrix", usedSheetNames),
    { views: [{ state: "frozen", ySplit: 2 }] }
  );
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
  const metricRows: Array<{
    label: string;
    format: ValueFormat;
    get: (m: EngineResult["metrics"]) => string | number;
  }> = [
    { label: "Building name", format: "text", get: (m) => m.buildingName },
    { label: "Suite / floor", format: "text", get: (m) => m.suiteName },
    { label: "RSF", format: "integer", get: (m) => m.rsf },
    { label: "Lease type", format: "text", get: (m) => m.leaseType },
    { label: "Term (months)", format: "integer", get: (m) => m.termMonths },
    { label: "Commencement", format: "date", get: (m) => m.commencementDate },
    { label: "Expiration", format: "date", get: (m) => m.expirationDate },
    { label: "Base rent ($/RSF/yr)", format: "currency_psf", get: (m) => m.baseRentPsfYr },
    { label: "Avg gross rent/month", format: "currency", get: (m) => m.avgGrossRentPerMonth },
    { label: "Avg all-in cost/month", format: "currency", get: (m) => m.avgAllInCostPerMonth },
    { label: "Avg all-in cost/year", format: "currency", get: (m) => m.avgAllInCostPerYear },
    { label: "Avg cost/RSF/year", format: "currency_psf", get: (m) => m.avgCostPsfYr },
    { label: "NPV @ discount rate", format: "currency", get: (m) => m.npvAtDiscount },
    { label: "Total obligation", format: "currency", get: (m) => m.totalObligation },
    { label: "Equalized avg cost/RSF/yr", format: "currency_psf", get: (m) => m.equalizedAvgCostPsfYr },
    { label: "Discount rate used", format: "percent", get: (m) => m.discountRateUsed },
    { label: "Notes", format: "text", get: (m) => buildCategorizedNoteSummary(m.notes ?? "") },
  ];
  metricRows.forEach(({ label, get, format }, rowIndex) => {
    const row = rowIndex + 3;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    results.forEach((res, colIndex) => {
      const val = get(res.metrics);
      const cell = summarySheet.getCell(row, colIndex + 2);
      cell.value = typeof val === "number" ? Number(val.toFixed(2)) : String(val ?? "");
      applyValueFormat(cell, format);
    });
  });

  const supplementalRows: Array<{
    label: string;
    format: ValueFormat;
    get: (scenario: LeaseScenarioCanonical, result: EngineResult) => string | number;
  }> = [
    { label: "Annual base rent escalation", format: "percent", get: (s) => s.rentSchedule?.annualEscalationPercent ?? 0 },
    { label: "Base operating expenses ($/RSF/yr)", format: "currency_psf", get: (s) => s.expenseSchedule?.baseOpexPsfYr ?? 0 },
    { label: "Annual opex escalation", format: "percent", get: (s) => s.expenseSchedule?.annualEscalationPercent ?? 0 },
    {
      label: "Rent abatement",
      format: "text",
      get: (s) => {
        const months = s.rentSchedule?.abatement?.months ?? 0;
        const t = s.rentSchedule?.abatement?.type ?? "none";
        return months > 0 ? `${months} months (${t})` : "None";
      },
    },
    {
      label: "Parking ratio (/1,000 SF)",
      format: "number",
      get: (s) => {
        const spaces = s.parkingSchedule?.spacesAllotted ?? 0;
        return safeDiv(spaces, s.partyAndPremises?.rentableSqFt ?? 0) * 1000;
      },
    },
    { label: "Allotted parking spaces", format: "integer", get: (s) => s.parkingSchedule?.spacesAllotted ?? 0 },
    { label: "Monthly parking cost", format: "currency", get: (_s, r) => safeDiv(r.metrics.parkingCostAnnual, 12) },
    { label: "TI budget ($/SF)", format: "currency_psf", get: (s) => safeDiv(s.tiSchedule?.budgetTotal ?? 0, s.partyAndPremises?.rentableSqFt ?? 0) },
    { label: "TI allowance ($/SF)", format: "currency_psf", get: (s) => safeDiv(s.tiSchedule?.allowanceFromLandlord ?? 0, s.partyAndPremises?.rentableSqFt ?? 0) },
    { label: "Up-front capex ($/SF)", format: "currency_psf", get: (s) => safeDiv(Math.max(0, s.tiSchedule?.outOfPocket ?? 0), s.partyAndPremises?.rentableSqFt ?? 0) },
    { label: "Up-front capex (gross)", format: "currency", get: (s) => Math.max(0, s.tiSchedule?.outOfPocket ?? 0) },
    { label: "Average gross rent/SF/year", format: "currency_psf", get: (_s, r) => safeDiv(r.metrics.avgGrossRentPerYear, r.metrics.rsf) },
    { label: "Average gross rent/year", format: "currency", get: (_s, r) => r.metrics.avgGrossRentPerYear },
    {
      label: "Equalized average cost/month",
      format: "currency",
      get: (_s, r) => safeDiv(r.metrics.equalizedAvgCostPsfYr * r.metrics.rsf, 12),
    },
    { label: "Equalized average cost/year", format: "currency", get: (_s, r) => r.metrics.equalizedAvgCostPsfYr * r.metrics.rsf },
  ];

  const supplementalStart = metricRows.length + 4;
  summarySheet.getCell(supplementalStart - 1, 1).value = "Additional lease economics";
  summarySheet.getCell(supplementalStart - 1, 1).font = { bold: true };
  results.forEach((_, i) => {
    summarySheet.getCell(supplementalStart - 1, i + 2).value = "";
  });
  supplementalRows.forEach(({ label, get, format }, rowIndex) => {
    const row = supplementalStart + rowIndex;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    results.forEach((res, colIndex) => {
      const val = get(scenarios[colIndex], res);
      const cell = summarySheet.getCell(row, colIndex + 2);
      cell.value = typeof val === "number" ? Number(val.toFixed(2)) : String(val ?? "");
      applyValueFormat(cell, format);
    });
  });
  styleSummaryMatrixGrid(summarySheet, supplementalStart + supplementalRows.length - 1, results.length + 1);
  const notesRowIndex = metricRows.findIndex((row) => row.label === "Notes");
  if (notesRowIndex >= 0) {
    styleWrappedNotesRow(summarySheet, 3 + notesRowIndex, results.length + 1);
  }

  // ---- Sheet 2+: Individual scenario sheets ----
  for (let idx = 0; idx < scenarios.length; idx++) {
    const scenario = scenarios[idx];
    const result = results[idx];
    const sheetName = makeUniqueSheetName(scenario.name || `Option ${idx + 1}`, `Option ${idx + 1}`, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });
    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 26;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 18;
    sheet.getColumn(6).width = 18;
    sheet.getColumn(7).width = 18;
    sheet.getColumn(8).width = 18;
    sheet.getColumn(9).width = 18;
    sheet.getColumn(10).width = 18;

    let row = 1;

    // SECTION A — Inputs
    sheet.getCell(row, 1).value = "SECTION A — Inputs";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const tiBudgetPsf = safeDiv(scenario.tiSchedule?.budgetTotal ?? 0, scenario.partyAndPremises?.rentableSqFt ?? 0);
    const tiAllowancePsf = safeDiv(scenario.tiSchedule?.allowanceFromLandlord ?? 0, scenario.partyAndPremises?.rentableSqFt ?? 0);
    const upFrontCapexGross = Math.max(0, scenario.tiSchedule?.outOfPocket ?? 0);
    const upFrontCapexPsf = safeDiv(upFrontCapexGross, scenario.partyAndPremises?.rentableSqFt ?? 0);
    const parkingSpaces = scenario.parkingSchedule?.spacesAllotted ?? 0;
    const parkingRatio = safeDiv(parkingSpaces, scenario.partyAndPremises?.rentableSqFt ?? 0) * 1000;
    const parkingMonthly = safeDiv(result.metrics.parkingCostAnnual, 12);
    const inputRows: Array<{ label: string; value: string | number; format: ValueFormat }> = [
      { label: "Scenario name", value: scenario.name ?? "", format: "text" },
      { label: "Building name", value: scenario.partyAndPremises?.premisesLabel ?? "", format: "text" },
      { label: "Suite / floor", value: scenario.partyAndPremises?.floorsOrSuite ?? "", format: "text" },
      { label: "Premises", value: scenario.partyAndPremises?.premisesName ?? "", format: "text" },
      { label: "Rentable square footage", value: scenario.partyAndPremises?.rentableSqFt ?? 0, format: "integer" },
      { label: "Lease type", value: scenario.expenseSchedule?.leaseType ?? "", format: "text" },
      { label: "Lease term (months)", value: scenario.datesAndTerm?.leaseTermMonths ?? 0, format: "integer" },
      { label: "Commencement date", value: scenario.datesAndTerm?.commencementDate ?? "", format: "date" },
      { label: "Expiration date", value: scenario.datesAndTerm?.expirationDate ?? "", format: "date" },
      { label: "Base rent ($/RSF/yr)", value: scenario.rentSchedule?.steps?.[0]?.ratePsfYr ?? 0, format: "currency_psf" },
      { label: "Annual base rent escalation %", value: scenario.rentSchedule?.annualEscalationPercent ?? 0, format: "percent" },
      { label: "Rent abatement months", value: scenario.rentSchedule?.abatement?.months ?? 0, format: "integer" },
      { label: "Base OpEx ($/RSF/yr)", value: scenario.expenseSchedule?.baseOpexPsfYr ?? 0, format: "currency_psf" },
      { label: "Annual OpEx escalation %", value: scenario.expenseSchedule?.annualEscalationPercent ?? 0, format: "percent" },
      { label: "Parking ratio (/1,000 SF)", value: parkingRatio, format: "number" },
      { label: "Allotted parking spaces", value: parkingSpaces, format: "integer" },
      { label: "Monthly parking cost", value: parkingMonthly, format: "currency" },
      { label: "TI budget ($/SF)", value: tiBudgetPsf, format: "currency_psf" },
      { label: "TI allowance ($/SF)", value: tiAllowancePsf, format: "currency_psf" },
      { label: "Up-front capex ($/SF)", value: upFrontCapexPsf, format: "currency_psf" },
      { label: "Up-front capex (gross)", value: upFrontCapexGross, format: "currency" },
      { label: "TI budget", value: scenario.tiSchedule?.budgetTotal ?? 0, format: "currency" },
      { label: "TI allowance", value: scenario.tiSchedule?.allowanceFromLandlord ?? 0, format: "currency" },
      { label: "TI out of pocket", value: scenario.tiSchedule?.outOfPocket ?? 0, format: "currency" },
      { label: "Amortize TI", value: scenario.tiSchedule?.amortizeOop ? "Yes" : "No", format: "text" },
      { label: "Parking (annual)", value: result.metrics.parkingCostAnnual, format: "currency" },
      { label: "Scenario notes", value: scenario.notes ?? "", format: "text" },
    ];
    inputRows.forEach(({ label, value, format }) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      const cell = sheet.getCell(row, 2);
      cell.value = typeof value === "number" ? Number(value.toFixed(2)) : value;
      applyValueFormat(cell, format);
      cell.alignment = format === "text" ? { wrapText: true, vertical: "top" } : cell.alignment;
      sheet.getCell(row, 1).border = THIN_BORDER;
      sheet.getCell(row, 2).border = THIN_BORDER;
      row++;
    });
    row += 2;

    // SECTION B — Monthly Cash Flow Table
    sheet.getCell(row, 1).value = "SECTION B — Monthly Cash Flow Table";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const monthlyHeaderRow = row;
    const monthlyHeaders = ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"];
    monthlyHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true };
      sheet.getCell(row, c + 1).fill = HEADER_FILL;
      sheet.getCell(row, c + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell(row, c + 1).border = THIN_BORDER;
    });
    row++;
    const monthlyStartRow = row;
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
      for (let c = 1; c <= 10; c++) sheet.getCell(row, c).border = THIN_BORDER;
      for (let c = 3; c <= 10; c++) applyValueFormat(sheet.getCell(row, c), "currency");
      row++;
    });
    const monthlyEndRow = row - 1;
    row += 2;

    // SECTION C — Annual Summary
    sheet.getCell(row, 1).value = "SECTION C — Annual Summary";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const annualHeaderRow = row;
    const annualHeaders = ["Year", "Total Cost", "Avg $/RSF", "Cumulative", "Discounted"];
    annualHeaders.forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).fill = HEADER_FILL;
      sheet.getCell(row, c + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell(row, c + 1).border = THIN_BORDER;
    });
    row++;
    const annualStartRow = row;
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
      for (let c = 1; c <= 5; c++) sheet.getCell(row, c).border = THIN_BORDER;
      applyValueFormat(sheet.getCell(row, 2), "currency");
      applyValueFormat(sheet.getCell(row, 3), "currency_psf");
      applyValueFormat(sheet.getCell(row, 4), "currency");
      applyValueFormat(sheet.getCell(row, 5), "currency");
      row++;
    });
    const annualEndRow = row - 1;
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
      sheet.getCell(row, 1).border = THIN_BORDER;
      sheet.getCell(row, 2).border = THIN_BORDER;
      if (typeof val === "number") applyValueFormat(sheet.getCell(row, 2), "currency");
      row++;
    });

    // Hidden monthly sheet (source of truth)
    const monthlySheetName = makeUniqueSheetName(`${sheetName}_Monthly`, `Option ${idx + 1}_Monthly`, usedSheetNames);
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
    for (let c = 1; c <= 10; c++) {
      monthlySheet.getColumn(c).width = c === 2 ? 14 : 16;
    }
    for (let r = 1; r <= result.monthly.length + 1; r++) {
      for (let c = 1; c <= 10; c++) {
        monthlySheet.getCell(r, c).border = THIN_BORDER;
      }
    }

    // Keep key section headers visually distinct.
    [monthlyHeaderRow, annualHeaderRow].forEach((r) => {
      for (let c = 1; c <= 10; c++) {
        if (sheet.getCell(r, c).value) {
          sheet.getCell(r, c).fill = HEADER_FILL;
          sheet.getCell(r, c).font = { bold: true, color: { argb: "FFFFFFFF" } };
        }
      }
    });
    if (monthlyEndRow >= monthlyStartRow) {
      for (let r = monthlyStartRow; r <= monthlyEndRow; r++) {
        if ((r - monthlyStartRow) % 2 === 1) {
          for (let c = 1; c <= 10; c++) sheet.getCell(r, c).fill = SUBHEADER_FILL;
        }
      }
    }
    if (annualEndRow >= annualStartRow) {
      for (let r = annualStartRow; r <= annualEndRow; r++) {
        if ((r - annualStartRow) % 2 === 1) {
          for (let c = 1; c <= 5; c++) sheet.getCell(r, c).fill = SUBHEADER_FILL;
        }
      }
    }
  }

  addMonthlyComparisonSheet(
    workbook,
    usedSheetNames,
    results.map((result) => ({
      name: result.scenarioName,
      rows: result.monthly.map((row) => ({
        monthIndex: row.monthIndex,
        date: row.periodStart,
        totalCost: row.total,
      })),
    }))
  );
  addNotesAndClausesSheet(
    workbook,
    usedSheetNames,
    scenarios.map((scenario, i) => ({
      scenario: results[i].scenarioName,
      sourceLabel: "Scenario notes",
      text: `${scenario.notes ?? ""}\n${results[i].metrics.notes ?? ""}`.trim(),
    }))
  );

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
  const usedSheetNames = new Set<string>();

  const summarySheet = workbook.addWorksheet(
    makeUniqueSheetName("Summary Matrix", "Summary Matrix", usedSheetNames),
    { views: [{ state: "frozen", ySplit: 2 }] }
  );
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
  const metricRows: Array<{
    label: string;
    format: ValueFormat;
    get: (m: CanonicalMetrics) => string | number;
  }> = [
    { label: "Building name", format: "text", get: (m) => m.building_name ?? "" },
    { label: "Suite / floor", format: "text", get: (m) => canonicalSuiteOrFloor(m.suite, m.floor) },
    { label: "RSF", format: "integer", get: (m) => m.rsf ?? 0 },
    { label: "Lease type", format: "text", get: (m) => m.lease_type ?? "" },
    { label: "Term (months)", format: "integer", get: (m) => m.term_months ?? 0 },
    { label: "Commencement", format: "date", get: (m) => m.commencement_date ?? "" },
    { label: "Expiration", format: "date", get: (m) => m.expiration_date ?? "" },
    { label: "Base rent ($/RSF/yr)", format: "currency_psf", get: (m) => m.base_rent_avg_psf_year ?? 0 },
    { label: "Avg gross rent/month", format: "currency", get: (m) => safeDiv((m.base_rent_total ?? 0) + (m.opex_total ?? 0) + (m.parking_total ?? 0), Math.max(1, m.term_months ?? 1)) },
    { label: "Avg all-in cost/month", format: "currency", get: (m) => safeDiv(m.total_obligation_nominal ?? 0, Math.max(1, m.term_months ?? 1)) },
    { label: "Avg all-in cost/year", format: "currency", get: (m) => safeDiv(m.total_obligation_nominal ?? 0, Math.max(1, (m.term_months ?? 1) / 12)) },
    { label: "Avg cost/RSF/year", format: "currency_psf", get: (m) => m.avg_all_in_cost_psf_year ?? 0 },
    { label: "NPV @ discount rate", format: "currency", get: (m) => m.npv_cost ?? 0 },
    { label: "Total obligation", format: "currency", get: (m) => m.total_obligation_nominal ?? 0 },
    { label: "Equalized avg cost/RSF/yr", format: "currency_psf", get: (m) => m.equalized_avg_cost_psf_year ?? 0 },
    { label: "Discount rate used", format: "percent", get: (m) => m.discount_rate_annual ?? 0.08 },
    { label: "Notes", format: "text", get: (m) => buildCategorizedNoteSummary(m.notes ?? "") },
  ];

  metricRows.forEach(({ label, get, format }, rowIndex) => {
    const row = rowIndex + 3;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    items.forEach((item, colIndex) => {
      const val = get(item.response.metrics);
      const cell = summarySheet.getCell(row, colIndex + 2);
      cell.value = typeof val === "number" ? Number(val.toFixed(2)) : String(val ?? "");
      applyValueFormat(cell, format);
    });
  });

  const supplementalRows: Array<{
    label: string;
    format: ValueFormat;
    get: (m: CanonicalMetrics, c: CanonicalComputeResponse["normalized_canonical_lease"]) => string | number;
  }> = [
    { label: "Annual base rent escalation", format: "percent", get: (m) => m.term_months > 12 ? safeDiv((m.base_rent_avg_psf_year ?? 0), (m.base_rent_avg_psf_year ?? 1)) - 1 : 0 },
    { label: "Base operating expenses ($/RSF/yr)", format: "currency_psf", get: (m, c) => c.opex_psf_year_1 ?? m.opex_avg_psf_year ?? 0 },
    { label: "Annual opex escalation", format: "percent", get: (_m, c) => c.opex_growth_rate ?? 0 },
    { label: "Rent abatement", format: "text", get: (_m, c) => (c.free_rent_months ?? 0) > 0 ? `${c.free_rent_months} months` : "None" },
    { label: "Parking ratio (/1,000 SF)", format: "number", get: (m, c) => safeDiv(c.parking_count ?? 0, m.rsf ?? 0) * 1000 },
    { label: "Allotted parking spaces", format: "integer", get: (_m, c) => c.parking_count ?? 0 },
    { label: "Monthly parking cost", format: "currency", get: (_m, c) => (c.parking_rate_monthly ?? 0) * (c.parking_count ?? 0) },
    { label: "TI budget ($/SF)", format: "currency_psf", get: () => 0 },
    { label: "TI allowance ($/SF)", format: "currency_psf", get: (_m, c) => c.ti_allowance_psf ?? 0 },
    { label: "Up-front capex ($/SF)", format: "currency_psf", get: () => 0 },
    { label: "Up-front capex (gross)", format: "currency", get: () => 0 },
    {
      label: "Average gross rent/SF/year",
      format: "currency_psf",
      get: (m) => safeDiv((m.base_rent_total ?? 0) + (m.opex_total ?? 0) + (m.parking_total ?? 0), Math.max(1, (m.term_months ?? 1) / 12) * Math.max(1, m.rsf ?? 1)),
    },
    {
      label: "Average gross rent/year",
      format: "currency",
      get: (m) => safeDiv((m.base_rent_total ?? 0) + (m.opex_total ?? 0) + (m.parking_total ?? 0), Math.max(1, (m.term_months ?? 1) / 12)),
    },
    {
      label: "Equalized average cost/month",
      format: "currency",
      get: (m) => safeDiv((m.equalized_avg_cost_psf_year ?? 0) * (m.rsf ?? 0), 12),
    },
    { label: "Equalized average cost/year", format: "currency", get: (m) => (m.equalized_avg_cost_psf_year ?? 0) * (m.rsf ?? 0) },
  ];

  const supplementalStart = metricRows.length + 4;
  summarySheet.getCell(supplementalStart - 1, 1).value = "Additional lease economics";
  summarySheet.getCell(supplementalStart - 1, 1).font = { bold: true };
  items.forEach((_, i) => {
    summarySheet.getCell(supplementalStart - 1, i + 2).value = "";
  });
  supplementalRows.forEach(({ label, get, format }, rowIndex) => {
    const row = supplementalStart + rowIndex;
    summarySheet.getCell(row, 1).value = label;
    summarySheet.getCell(row, 1).font = { bold: true };
    items.forEach((item, colIndex) => {
      const val = get(item.response.metrics, item.response.normalized_canonical_lease);
      const cell = summarySheet.getCell(row, colIndex + 2);
      cell.value = typeof val === "number" ? Number(val.toFixed(2)) : String(val ?? "");
      applyValueFormat(cell, format);
    });
  });
  styleSummaryMatrixGrid(summarySheet, supplementalStart + supplementalRows.length - 1, items.length + 1);
  const notesRowIndex = metricRows.findIndex((row) => row.label === "Notes");
  if (notesRowIndex >= 0) {
    styleWrappedNotesRow(summarySheet, 3 + notesRowIndex, items.length + 1);
  }

  for (let idx = 0; idx < items.length; idx++) {
    const { response, scenarioName } = items[idx];
    const c = response.normalized_canonical_lease;
    const m = response.metrics;
    const sheetName = makeUniqueSheetName(scenarioName || `Option ${idx + 1}`, `Option ${idx + 1}`, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 4 }] });
    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 26;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 18;
    sheet.getColumn(6).width = 18;
    sheet.getColumn(7).width = 18;
    sheet.getColumn(8).width = 18;
    sheet.getColumn(9).width = 18;
    sheet.getColumn(10).width = 18;
    let row = 1;
    sheet.getCell(row, 1).value = "SECTION A — Inputs";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const parkingRatio = safeDiv(c.parking_count ?? 0, m.rsf ?? 0) * 1000;
    const parkingMonthly = (c.parking_rate_monthly ?? 0) * (c.parking_count ?? 0);
    const grossAnnual = safeDiv((m.base_rent_total ?? 0) + (m.opex_total ?? 0) + (m.parking_total ?? 0), Math.max(1, (m.term_months ?? 1) / 12));
    const inputRows: Array<{ label: string; value: string | number; format: ValueFormat }> = [
      { label: "Scenario name", value: scenarioName, format: "text" },
      { label: "Building name", value: m.building_name ?? c.building_name ?? "", format: "text" },
      { label: "Suite / floor", value: canonicalSuiteOrFloor(m.suite ?? c.suite, m.floor ?? c.floor), format: "text" },
      { label: "Premises", value: m.premises_name ?? c.premises_name ?? "", format: "text" },
      { label: "Rentable square footage", value: m.rsf ?? 0, format: "integer" },
      { label: "Lease type", value: m.lease_type ?? c.lease_type ?? "", format: "text" },
      { label: "Lease term (months)", value: m.term_months ?? 0, format: "integer" },
      { label: "Commencement date", value: m.commencement_date ?? "", format: "date" },
      { label: "Expiration date", value: m.expiration_date ?? "", format: "date" },
      { label: "Base rent ($/RSF/yr)", value: m.base_rent_avg_psf_year ?? 0, format: "currency_psf" },
      { label: "Base OpEx ($/RSF/yr)", value: m.opex_avg_psf_year ?? 0, format: "currency_psf" },
      { label: "Annual OpEx escalation %", value: c.opex_growth_rate ?? 0, format: "percent" },
      { label: "Rent abatement months", value: c.free_rent_months ?? 0, format: "integer" },
      { label: "Parking ratio (/1,000 SF)", value: parkingRatio, format: "number" },
      { label: "Allotted parking spaces", value: c.parking_count ?? 0, format: "integer" },
      { label: "Monthly parking cost", value: parkingMonthly, format: "currency" },
      { label: "TI allowance ($/SF)", value: c.ti_allowance_psf ?? 0, format: "currency_psf" },
      { label: "TI allowance", value: m.ti_value_total ?? 0, format: "currency" },
      { label: "Parking (annual)", value: m.parking_total ?? 0, format: "currency" },
      { label: "Average gross rent/year", value: grossAnnual, format: "currency" },
      { label: "Total obligation", value: m.total_obligation_nominal ?? 0, format: "currency" },
      { label: "NPV", value: m.npv_cost ?? 0, format: "currency" },
      {
        label: "Notes",
        value: buildCategorizedNoteSummary(`${m.notes ?? ""}\n${String(c.notes ?? "")}`.trim()),
        format: "text",
      },
    ];
    inputRows.forEach(({ label, value, format }) => {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 1).font = { bold: true };
      const cell = sheet.getCell(row, 2);
      cell.value = typeof value === "number" ? Number(value.toFixed(2)) : value;
      applyValueFormat(cell, format);
      cell.alignment = format === "text" ? { wrapText: true, vertical: "top" } : cell.alignment;
      sheet.getCell(row, 1).border = THIN_BORDER;
      sheet.getCell(row, 2).border = THIN_BORDER;
      row++;
    });
    row += 2;
    sheet.getCell(row, 1).value = "SECTION B — Monthly Cash Flow Table";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const monthlyHeaderRow = row;
    ["Month", "Date", "Base Rent", "Opex", "Parking", "TI Amort", "Concessions", "Total Cost", "Cumulative", "Discounted"].forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell(row, c + 1).fill = HEADER_FILL;
      sheet.getCell(row, c + 1).border = THIN_BORDER;
    });
    row++;
    const monthlyStartRow = row;
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
      for (let c = 1; c <= 10; c++) sheet.getCell(row, c).border = THIN_BORDER;
      for (let c = 3; c <= 10; c++) applyValueFormat(sheet.getCell(row, c), "currency");
      row++;
    });
    const monthlyEndRow = row - 1;
    row += 2;
    sheet.getCell(row, 1).value = "SECTION C — Annual Summary";
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;
    const annualHeaderRow = row;
    ["Year", "Total Cost", "Avg $/RSF", "Cumulative", "Discounted"].forEach((h, c) => {
      sheet.getCell(row, c + 1).value = h;
      sheet.getCell(row, c + 1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell(row, c + 1).fill = HEADER_FILL;
      sheet.getCell(row, c + 1).border = THIN_BORDER;
    });
    row++;
    const annualStartRow = row;
    response.annual_rows.forEach((yr) => {
      sheet.getCell(row, 1).value = yr.year_index + 1;
      sheet.getCell(row, 2).value = yr.total_cost;
      sheet.getCell(row, 3).value = yr.avg_cost_psf_year;
      sheet.getCell(row, 4).value = yr.cumulative_cost;
      sheet.getCell(row, 5).value = yr.discounted_value;
      for (let c = 1; c <= 5; c++) sheet.getCell(row, c).border = THIN_BORDER;
      applyValueFormat(sheet.getCell(row, 2), "currency");
      applyValueFormat(sheet.getCell(row, 3), "currency_psf");
      applyValueFormat(sheet.getCell(row, 4), "currency");
      applyValueFormat(sheet.getCell(row, 5), "currency");
      row++;
    });
    const annualEndRow = row - 1;
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
      sheet.getCell(row, 1).border = THIN_BORDER;
      sheet.getCell(row, 2).border = THIN_BORDER;
      if (typeof val === "number") applyValueFormat(sheet.getCell(row, 2), "currency");
      row++;
    });
    const monthlySheetName = makeUniqueSheetName(`${sheetName}_Monthly`, `Option ${idx + 1}_Monthly`, usedSheetNames);
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
    for (let c = 1; c <= 10; c++) {
      monthlySheet.getColumn(c).width = c === 2 ? 14 : 16;
    }
    for (let r = 1; r <= response.monthly_rows.length + 1; r++) {
      for (let c = 1; c <= 10; c++) monthlySheet.getCell(r, c).border = THIN_BORDER;
    }

    [monthlyHeaderRow, annualHeaderRow].forEach((r) => {
      for (let c = 1; c <= 10; c++) {
        if (sheet.getCell(r, c).value) {
          sheet.getCell(r, c).fill = HEADER_FILL;
          sheet.getCell(r, c).font = { bold: true, color: { argb: "FFFFFFFF" } };
        }
      }
    });
    if (monthlyEndRow >= monthlyStartRow) {
      for (let r = monthlyStartRow; r <= monthlyEndRow; r++) {
        if ((r - monthlyStartRow) % 2 === 1) {
          for (let c = 1; c <= 10; c++) sheet.getCell(r, c).fill = SUBHEADER_FILL;
        }
      }
    }
    if (annualEndRow >= annualStartRow) {
      for (let r = annualStartRow; r <= annualEndRow; r++) {
        if ((r - annualStartRow) % 2 === 1) {
          for (let c = 1; c <= 5; c++) sheet.getCell(r, c).fill = SUBHEADER_FILL;
        }
      }
    }
  }

  addMonthlyComparisonSheet(
    workbook,
    usedSheetNames,
    items.map((item) => ({
      name: item.scenarioName,
      rows: item.response.monthly_rows.map((row) => ({
        monthIndex: row.month_index,
        date: row.date,
        totalCost: row.total_cost,
      })),
    }))
  );
  addNotesAndClausesSheet(
    workbook,
    usedSheetNames,
    items.flatMap((item) => [
      {
        scenario: item.scenarioName,
        sourceLabel: "Metrics notes",
        text: item.response.metrics.notes ?? "",
      },
      {
        scenario: item.scenarioName,
        sourceLabel: "Canonical notes",
        text: String(item.response.normalized_canonical_lease.notes ?? ""),
      },
      {
        scenario: item.scenarioName,
        sourceLabel: "Assumptions",
        text: (item.response.assumptions ?? []).join(". "),
      },
      {
        scenario: item.scenarioName,
        sourceLabel: "Warnings",
        text: (item.response.warnings ?? []).join(". "),
      },
    ])
  );

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
