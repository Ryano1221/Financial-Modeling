import ExcelJS from "exceljs";
import type { LeaseScenarioCanonical } from "@/lib/lease-engine/canonical-schema";
import type { EngineResult, MonthlyRow } from "@/lib/lease-engine/monthly-engine";
import { runMonthlyEngine } from "@/lib/lease-engine/monthly-engine";
import { buildWorkbook as buildWorkbookLegacy } from "@/lib/lease-engine/excel-export";
import type { CanonicalComputeResponse } from "@/lib/types";

export const TEMPLATE_VERSION = "2.0";

export const SUMMARY_MATRIX_ROW_LABELS = [
  "Document type",
  "Building name",
  "Suite / floor",
  "Street address",
  "RSF",
  "Commencement",
  "Expiration",
  "Lease type",
  "Term (months)",
  "Rent (nominal)",
  "OpEx (nominal)",
  "OpEx escalation %",
  "Discount rate",
  "Parking cost ($/spot/month, pre-tax)",
  "Parking sales tax %",
  "Parking cost ($/spot/month, after tax)",
  "Parking cost (annual)",
  "TI budget",
  "TI allowance",
  "TI out of pocket",
  "Total obligation",
  "NPV cost",
  "Avg cost/year",
  "Avg cost/SF/year",
  "Equalized avg cost/RSF/yr",
  "Notes",
] as const;

const BRAND_COLORS = {
  black: "FF000000",
  accentRed: "FFE10600",
  lightGray: "FFF2F2F2",
  darkGray: "FF1A1A1A",
  white: "FFFFFFFF",
  border: "FFB5B5B5",
  text: "FF111111",
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BRAND_COLORS.border } },
  left: { style: "thin", color: { argb: BRAND_COLORS.border } },
  bottom: { style: "thin", color: { argb: BRAND_COLORS.border } },
  right: { style: "thin", color: { argb: BRAND_COLORS.border } },
};

const BORDER_MEDIUM: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: BRAND_COLORS.darkGray } },
  left: { style: "medium", color: { argb: BRAND_COLORS.darkGray } },
  bottom: { style: "medium", color: { argb: BRAND_COLORS.darkGray } },
  right: { style: "medium", color: { argb: BRAND_COLORS.darkGray } },
};

const BORDER_THICK: Partial<ExcelJS.Borders> = {
  top: { style: "thick", color: { argb: BRAND_COLORS.black } },
  left: { style: "thick", color: { argb: BRAND_COLORS.black } },
  bottom: { style: "thick", color: { argb: BRAND_COLORS.black } },
  right: { style: "thick", color: { argb: BRAND_COLORS.black } },
};

const CURRENCY_NO_CENTS = '"$"#,##0;[Red]-"$"#,##0';
const CURRENCY_PSf = '"$"#,##0.00';
const PERCENT_2 = "0.00%";

type CellFormat = "text" | "currency0" | "currency2" | "percent" | "integer" | "date";

export interface WorkbookBrandingMeta {
  brokerageName?: string;
  clientName?: string;
  reportDate?: string;
  preparedBy?: string;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
}

interface WorkbookMonthlyRow {
  monthIndex: number;
  date: string;
  baseRent: number;
  opex: number;
  parking: number;
  tiAmort: number;
  concessions: number;
  totalCost: number;
  cumulativeCost: number;
  discountedValue: number;
}

interface WorkbookScenario {
  id: string;
  name: string;
  documentType: string;
  buildingName: string;
  suiteFloor: string;
  streetAddress: string;
  rsf: number;
  leaseType: string;
  termMonths: number;
  commencementDate: string;
  expirationDate: string;
  rentNominal: number;
  opexNominal: number;
  opexEscalationPct: number;
  discountRate: number;
  parkingCostPerSpotPreTax: number;
  parkingSalesTaxPct: number;
  parkingCostPerSpotAfterTax: number;
  parkingCostAnnual: number;
  tiBudget: number;
  tiAllowance: number;
  tiOutOfPocket: number;
  totalObligation: number;
  npvCost: number;
  avgCostYear: number;
  avgCostPsfYear: number;
  equalizedAvgCostPsfYear: number;
  notes: string;
  monthlyRows: WorkbookMonthlyRow[];
}

interface EqualizedScenarioMetrics {
  avgGrossRentPsfYear: number;
  avgGrossRentMonth: number;
  avgCostPsfYear: number;
  avgCostMonth: number;
  totalCost: number;
  npv: number;
}

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

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.replace(/\./g, "-").replace(/\//g, "-");
  const parts = normalized.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [first, second, third] = parts;
  const year = first > 31 ? first : third;
  const month = first > 31 ? second : first;
  const day = first > 31 ? third : second;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function formatDateMmDdYyyy(value?: string | null): string {
  const date = parseIsoDate(value);
  if (!date) return value ?? "";
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  const yyyy = `${date.getUTCFullYear()}`;
  return `${mm}.${dd}.${yyyy}`;
}

function toIsoDate(date: Date): string {
  const y = `${date.getUTCFullYear()}`;
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addMonths(date: Date, offset: number): Date {
  const clone = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  clone.setUTCMonth(clone.getUTCMonth() + offset);
  return clone;
}

function monthDiffInclusive(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
}

function buildMonthTimeline(start: Date, end: Date): Date[] {
  const months = monthDiffInclusive(start, end);
  return Array.from({ length: Math.max(0, months) }, (_, idx) => addMonths(start, idx));
}

function normalizeText(value: string | undefined | null, fallback = ""): string {
  return (value ?? fallback).toString().trim();
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
    .flatMap(([category, details]) => details.map((detail) => `• ${category}: ${detail}`))
    .join("\n");
}

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[/\\?*\[\]:]/g, "").trim();
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

function applyCellFormat(cell: ExcelJS.Cell, format: CellFormat): void {
  if (format === "currency0") {
    cell.numFmt = CURRENCY_NO_CENTS;
    cell.alignment = { horizontal: "right", vertical: "middle" };
    return;
  }
  if (format === "currency2") {
    cell.numFmt = CURRENCY_PSf;
    cell.alignment = { horizontal: "right", vertical: "middle" };
    return;
  }
  if (format === "percent") {
    cell.numFmt = PERCENT_2;
    cell.alignment = { horizontal: "right", vertical: "middle" };
    return;
  }
  if (format === "integer") {
    cell.numFmt = "#,##0";
    cell.alignment = { horizontal: "right", vertical: "middle" };
    return;
  }
  if (format === "date") {
    cell.alignment = { horizontal: "center", vertical: "middle" };
    return;
  }
  cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
}

type ExcelImagePayload = {
  base64: string;
  extension: "png" | "jpeg";
};

function parseExcelImageData(dataUrl?: string | null): ExcelImagePayload | null {
  const raw = String(dataUrl ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  let extension: "png" | "jpeg" | null = null;
  if (subtype === "png") extension = "png";
  else if (subtype === "jpeg" || subtype === "jpg") extension = "jpeg";
  if (!extension) return null;
  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;
  return { base64, extension };
}

function addCoverLogoImage(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  dataUrl: string | null | undefined,
  box: { col: number; row: number; widthCols: number; heightRows: number }
): boolean {
  const parsed = parseExcelImageData(dataUrl);
  if (!parsed) return false;
  try {
    const imageId = workbook.addImage({
      base64: parsed.base64,
      extension: parsed.extension,
    });
    const pxPerCol = 64;
    const pxPerRow = 20;
    sheet.addImage(imageId, {
      tl: { col: box.col - 1 + 0.1, row: box.row - 1 + 0.1 },
      ext: {
        width: Math.max(120, Math.floor(box.widthCols * pxPerCol - 12)),
        height: Math.max(55, Math.floor(box.heightRows * pxPerRow - 6)),
      },
    });
    return true;
  } catch {
    return false;
  }
}

function setSheetPrintSettings(sheet: ExcelJS.Worksheet, opts: { landscape: boolean; repeatHeaderRow?: number }): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: opts.landscape ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };
  if (opts.repeatHeaderRow) {
    const pageSetup = sheet.pageSetup as unknown as { printTitlesRow?: string };
    pageSetup.printTitlesRow = `${opts.repeatHeaderRow}:${opts.repeatHeaderRow}`;
  }
}

function setView(sheet: ExcelJS.Worksheet, opts: { xSplit?: number; ySplit?: number }): void {
  sheet.views = [
    {
      state: (opts.xSplit || opts.ySplit) ? "frozen" : "normal",
      xSplit: opts.xSplit ?? 0,
      ySplit: opts.ySplit ?? 0,
      showGridLines: false,
    },
  ];
}

function autoSizeColumns(sheet: ExcelJS.Worksheet, min = 10, max = 42): void {
  sheet.columns?.forEach((column) => {
    if (!column || typeof column.eachCell !== "function") return;
    let longest = min;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const raw = cell.value;
      let text = "";
      if (raw == null) text = "";
      else if (typeof raw === "object" && "richText" in raw && Array.isArray(raw.richText)) {
        text = raw.richText.map((run) => run.text).join("");
      } else if (typeof raw === "object" && "text" in raw && typeof raw.text === "string") {
        text = raw.text;
      } else {
        text = `${raw}`;
      }
      const longestLine = text
        .split("\n")
        .reduce((acc, line) => Math.max(acc, line.trim().length), 0);
      longest = Math.max(longest, longestLine + 2);
    });
    column.width = Math.min(max, Math.max(min, longest));
  });
}

function applyOuterBorder(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, startCol: number, endCol: number): void {
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = sheet.getCell(row, col);
      const base = { ...(cell.border ?? {}) };
      if (row === startRow) base.top = BORDER_THICK.top;
      if (row === endRow) base.bottom = BORDER_THICK.bottom;
      if (col === startCol) base.left = BORDER_THICK.left;
      if (col === endCol) base.right = BORDER_THICK.right;
      cell.border = base;
    }
  }
}

function buildWorkbookScenariosFromCanonical(
  scenarios: LeaseScenarioCanonical[],
  results: EngineResult[]
): WorkbookScenario[] {
  return scenarios.map((scenario, idx) => {
    const result = results[idx];
    const parkingPreTax = result.metrics.parkingCostPerSpotMonthlyPreTax
      ?? safeDiv(result.metrics.parkingCostPerSpotMonthly ?? 0, 1 + (result.metrics.parkingSalesTaxPercent ?? 0));
    return {
      id: scenario.id,
      name: result.scenarioName || scenario.name,
      documentType: "Lease",
      buildingName: normalizeText(result.metrics.buildingName, scenario.partyAndPremises.premisesLabel ?? scenario.partyAndPremises.premisesName),
      suiteFloor: normalizeText(result.metrics.suiteName, scenario.partyAndPremises.floorsOrSuite ?? ""),
      streetAddress: normalizeText(scenario.partyAndPremises.premisesName),
      rsf: result.metrics.rsf,
      leaseType: result.metrics.leaseType.toUpperCase(),
      termMonths: result.metrics.termMonths,
      commencementDate: result.metrics.commencementDate,
      expirationDate: result.metrics.expirationDate,
      rentNominal: result.monthly.reduce((sum, row) => sum + row.baseRent, 0),
      opexNominal: result.monthly.reduce((sum, row) => sum + row.opex, 0),
      opexEscalationPct: scenario.expenseSchedule.annualEscalationPercent,
      discountRate: result.metrics.discountRateUsed,
      parkingCostPerSpotPreTax: parkingPreTax,
      parkingSalesTaxPct: result.metrics.parkingSalesTaxPercent ?? 0.0825,
      parkingCostPerSpotAfterTax: result.metrics.parkingCostPerSpotMonthly ?? 0,
      parkingCostAnnual: result.metrics.parkingCostAnnual,
      tiBudget: scenario.tiSchedule.budgetTotal,
      tiAllowance: scenario.tiSchedule.allowanceFromLandlord,
      tiOutOfPocket: Math.max(0, scenario.tiSchedule.outOfPocket),
      totalObligation: result.metrics.totalObligation,
      npvCost: result.metrics.npvAtDiscount,
      avgCostYear: result.metrics.avgAllInCostPerYear,
      avgCostPsfYear: result.metrics.avgCostPsfYr,
      equalizedAvgCostPsfYear: result.metrics.equalizedAvgCostPsfYr,
      notes: buildCategorizedNoteSummary(`${scenario.notes ?? ""}\n${result.metrics.notes ?? ""}`.trim()),
      monthlyRows: result.monthly.map((row) => ({
        monthIndex: row.monthIndex,
        date: row.periodStart,
        baseRent: row.baseRent,
        opex: row.opex,
        parking: row.parking,
        tiAmort: row.tiAmortization,
        concessions: 0,
        totalCost: row.total,
        cumulativeCost: row.cumulativeCost,
        discountedValue: row.discountedValue,
      })),
    };
  });
}

function buildWorkbookScenariosFromCanonicalResponses(
  items: { response: CanonicalComputeResponse; scenarioName: string }[]
): WorkbookScenario[] {
  return items.map((item, idx) => {
    const c = item.response.normalized_canonical_lease;
    const m = item.response.metrics;
    const parkingPreTax = c.parking_rate_monthly ?? 0;
    const parkingTax = c.parking_sales_tax_rate ?? 0.0825;
    const notesText = [
      m.notes ?? "",
      String(c.notes ?? ""),
      ...(item.response.warnings ?? []),
      ...(item.response.assumptions ?? []),
    ].filter(Boolean).join(". ");
    return {
      id: `canonical-${idx + 1}`,
      name: item.scenarioName,
      documentType: normalizeText(c.document_type_detected, "Lease"),
      buildingName: normalizeText(m.building_name, c.building_name ?? m.premises_name),
      suiteFloor: normalizeText(m.suite || m.floor ? [m.suite, m.floor ? `Floor ${m.floor}` : ""].filter(Boolean).join(" / ") : ""),
      streetAddress: normalizeText(m.address, c.address ?? ""),
      rsf: m.rsf,
      leaseType: normalizeText(m.lease_type, c.lease_type ?? "").toUpperCase(),
      termMonths: m.term_months,
      commencementDate: m.commencement_date,
      expirationDate: m.expiration_date,
      rentNominal: m.base_rent_total,
      opexNominal: m.opex_total,
      opexEscalationPct: c.opex_growth_rate ?? 0,
      discountRate: m.discount_rate_annual,
      parkingCostPerSpotPreTax: parkingPreTax,
      parkingSalesTaxPct: parkingTax,
      parkingCostPerSpotAfterTax: parkingPreTax * (1 + parkingTax),
      parkingCostAnnual: m.parking_total,
      tiBudget: m.ti_value_total,
      tiAllowance: m.ti_value_total,
      tiOutOfPocket: 0,
      totalObligation: m.total_obligation_nominal,
      npvCost: m.npv_cost,
      avgCostYear: safeDiv(m.total_obligation_nominal, Math.max(1, m.term_months / 12)),
      avgCostPsfYear: m.avg_all_in_cost_psf_year,
      equalizedAvgCostPsfYear: m.equalized_avg_cost_psf_year,
      notes: buildCategorizedNoteSummary(notesText),
      monthlyRows: item.response.monthly_rows.map((row) => ({
        monthIndex: row.month_index,
        date: row.date,
        baseRent: row.base_rent,
        opex: row.opex,
        parking: row.parking,
        tiAmort: row.ti_amort,
        concessions: row.concessions,
        totalCost: row.total_cost,
        cumulativeCost: row.cumulative_cost,
        discountedValue: row.discounted_value,
      })),
    };
  });
}

function computeEqualizedMetrics(
  scenarios: WorkbookScenario[]
): { start: Date | null; end: Date | null; metrics: Record<string, EqualizedScenarioMetrics> } {
  if (scenarios.length === 0) return { start: null, end: null, metrics: {} };
  const commDates = scenarios
    .map((scenario) => parseIsoDate(scenario.commencementDate))
    .filter((date): date is Date => date !== null);
  const expDates = scenarios
    .map((scenario) => parseIsoDate(scenario.expirationDate))
    .filter((date): date is Date => date !== null);
  if (commDates.length === 0 || expDates.length === 0) return { start: null, end: null, metrics: {} };

  const start = new Date(Math.max(...commDates.map((date) => date.getTime())));
  const end = new Date(Math.min(...expDates.map((date) => date.getTime())));
  if (end.getTime() < start.getTime()) return { start, end, metrics: {} };

  const windowDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const output: Record<string, EqualizedScenarioMetrics> = {};
  for (const scenario of scenarios) {
    const rows = scenario.monthlyRows.filter((row) => {
      const date = parseIsoDate(row.date);
      if (!date) return false;
      return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
    });
    const monthCount = Math.max(1, rows.length);
    const annualDivisor = windowDays / 365;
    const grossTotal = rows.reduce((sum, row) => sum + row.baseRent + row.opex + row.parking, 0);
    const recurringTotal = grossTotal;
    const totalCost = rows.reduce((sum, row) => sum + row.totalCost, 0);
    const monthlyRate = Math.pow(1 + (scenario.discountRate || 0.08), 1 / 12) - 1;
    const npv = rows.reduce((sum, row, idx) => sum + row.totalCost / Math.pow(1 + monthlyRate, idx), 0);
    output[scenario.id] = {
      avgGrossRentPsfYear: safeDiv(grossTotal, Math.max(1, scenario.rsf) * annualDivisor),
      avgGrossRentMonth: safeDiv(grossTotal, monthCount),
      avgCostPsfYear: safeDiv(recurringTotal, Math.max(1, scenario.rsf) * annualDivisor),
      avgCostMonth: safeDiv(recurringTotal, monthCount),
      totalCost,
      npv,
    };
  }
  return { start, end, metrics: output };
}

function createCoverSheet(
  workbook: ExcelJS.Workbook,
  usedNames: Set<string>,
  meta: WorkbookBrandingMeta,
  scenarioCount: number
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Cover", "Cover", usedNames));
  setView(sheet, {});
  setSheetPrintSettings(sheet, { landscape: false });
  sheet.pageSetup.verticalCentered = true;
  sheet.properties.defaultRowHeight = 24;
  sheet.columns = new Array(8).fill(null).map(() => ({ width: 18 }));

  sheet.mergeCells("A1:H3");
  const header = sheet.getCell("A1");
  header.value = "THE COMMERCIAL REAL ESTATE MODEL\nLease Financial Analysis";
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.black } };
  header.font = { color: { argb: BRAND_COLORS.white }, bold: true, size: 22, name: "Aptos" };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

  const hasBrokerageLogo = addCoverLogoImage(workbook, sheet, meta.brokerageLogoDataUrl, {
    col: 1,
    row: 5,
    widthCols: 4,
    heightRows: 4,
  });
  const hasClientLogo = addCoverLogoImage(workbook, sheet, meta.clientLogoDataUrl, {
    col: 5,
    row: 5,
    widthCols: 4,
    heightRows: 4,
  });

  const reportDate = formatDateMmDdYyyy(meta.reportDate ?? toIsoDate(new Date()));
  const brokerage = normalizeText(meta.brokerageName, "theCREmodel");
  const client = normalizeText(meta.clientName, "Client");
  const preparedBy = normalizeText(meta.preparedBy, "theCREmodel");

  const rightMetaRows: Array<[string, string]> = [
    ["Brokerage", brokerage],
    ["Client", client],
    ["Report date", reportDate],
    ["Prepared by", preparedBy],
    ["Scenarios", `${scenarioCount}`],
  ];
  let row = 11;
  for (const [label, value] of rightMetaRows) {
    sheet.mergeCells(row, 5, row, 6);
    sheet.mergeCells(row, 7, row, 8);
    const labelCell = sheet.getCell(row, 5);
    const valueCell = sheet.getCell(row, 7);
    labelCell.value = label.toUpperCase();
    valueCell.value = value;
    labelCell.font = { bold: true, size: 10, color: { argb: BRAND_COLORS.darkGray }, name: "Aptos" };
    valueCell.font = { bold: true, size: 12, color: { argb: BRAND_COLORS.text }, name: "Aptos" };
    labelCell.alignment = { horizontal: "right", vertical: "middle" };
    valueCell.alignment = { horizontal: "right", vertical: "middle" };
    row += 2;
  }

  sheet.mergeCells("A11:D19");
  const leftBlock = sheet.getCell("A11");
  leftBlock.value = "Institutional comparison workbook\nPrepared for brokerage delivery\nPrint-ready formatted export";
  leftBlock.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  leftBlock.font = { name: "Aptos", size: 14, color: { argb: BRAND_COLORS.text } };

  if (!hasBrokerageLogo) {
    sheet.mergeCells("A5:D8");
    const brokerageFallback = sheet.getCell("A5");
    brokerageFallback.value = brokerage;
    brokerageFallback.font = { name: "Aptos", size: 16, bold: true, color: { argb: BRAND_COLORS.text } };
    brokerageFallback.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  if (!hasClientLogo) {
    sheet.mergeCells("E5:H8");
    const clientFallback = sheet.getCell("E5");
    clientFallback.value = client;
    clientFallback.font = { name: "Aptos", size: 14, bold: true, color: { argb: BRAND_COLORS.text } };
    clientFallback.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  }

  sheet.mergeCells("A23:H23");
  const footer = sheet.getCell("A23");
  footer.value = `Template Version ${TEMPLATE_VERSION}`;
  footer.font = { name: "Aptos", size: 10, color: { argb: "FF666666" } };
  footer.alignment = { horizontal: "center", vertical: "middle" };
}

function createSummaryComparisonSheet(workbook: ExcelJS.Workbook, usedNames: Set<string>, scenarios: WorkbookScenario[]): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Summary Comparison", "Summary Comparison", usedNames));
  setView(sheet, { xSplit: 1, ySplit: 1 });
  setSheetPrintSettings(sheet, { landscape: true, repeatHeaderRow: 1 });
  sheet.properties.defaultRowHeight = 22;

  const scenarioColCount = scenarios.length;
  sheet.getColumn(1).width = 34;
  for (let i = 0; i < scenarioColCount; i++) {
    sheet.getColumn(i + 2).width = 26;
  }

  sheet.getCell(1, 1).value = "Metric";
  sheet.getCell(1, 1).font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
  sheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(1, idx + 2);
    cell.value = scenario.name;
    cell.font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  type SummaryRow = { type: "section"; label: string } | {
    type: "metric";
    label: string;
    format: CellFormat;
    getValue: (scenario: WorkbookScenario) => string | number;
  };

  const rows: SummaryRow[] = [
    { type: "section", label: "PREMISES" },
    { type: "metric", label: "Document type", format: "text", getValue: (s) => s.documentType },
    { type: "metric", label: "Building name", format: "text", getValue: (s) => s.buildingName },
    { type: "metric", label: "Suite / floor", format: "text", getValue: (s) => s.suiteFloor },
    { type: "metric", label: "Street address", format: "text", getValue: (s) => s.streetAddress },
    { type: "metric", label: "RSF", format: "integer", getValue: (s) => s.rsf },
    { type: "metric", label: "Commencement", format: "date", getValue: (s) => formatDateMmDdYyyy(s.commencementDate) },
    { type: "metric", label: "Expiration", format: "date", getValue: (s) => formatDateMmDdYyyy(s.expirationDate) },
    { type: "section", label: "RENT STRUCTURE" },
    { type: "metric", label: "Lease type", format: "text", getValue: (s) => s.leaseType },
    { type: "metric", label: "Term (months)", format: "integer", getValue: (s) => s.termMonths },
    { type: "metric", label: "Rent (nominal)", format: "currency0", getValue: (s) => s.rentNominal },
    { type: "metric", label: "OpEx (nominal)", format: "currency0", getValue: (s) => s.opexNominal },
    { type: "metric", label: "OpEx escalation %", format: "percent", getValue: (s) => s.opexEscalationPct },
    { type: "metric", label: "Discount rate", format: "percent", getValue: (s) => s.discountRate },
    { type: "section", label: "PARKING" },
    { type: "metric", label: "Parking cost ($/spot/month, pre-tax)", format: "currency0", getValue: (s) => s.parkingCostPerSpotPreTax },
    { type: "metric", label: "Parking sales tax %", format: "percent", getValue: (s) => s.parkingSalesTaxPct },
    { type: "metric", label: "Parking cost ($/spot/month, after tax)", format: "currency0", getValue: (s) => s.parkingCostPerSpotAfterTax },
    { type: "metric", label: "Parking cost (annual)", format: "currency0", getValue: (s) => s.parkingCostAnnual },
    { type: "section", label: "TI / CAPEX" },
    { type: "metric", label: "TI budget", format: "currency0", getValue: (s) => s.tiBudget },
    { type: "metric", label: "TI allowance", format: "currency0", getValue: (s) => s.tiAllowance },
    { type: "metric", label: "TI out of pocket", format: "currency0", getValue: (s) => s.tiOutOfPocket },
    { type: "section", label: "SUMMARY METRICS" },
    { type: "metric", label: "Total obligation", format: "currency0", getValue: (s) => s.totalObligation },
    { type: "metric", label: "NPV cost", format: "currency0", getValue: (s) => s.npvCost },
    { type: "metric", label: "Avg cost/year", format: "currency0", getValue: (s) => s.avgCostYear },
    { type: "metric", label: "Avg cost/SF/year", format: "currency2", getValue: (s) => s.avgCostPsfYear },
    { type: "metric", label: "Equalized avg cost/RSF/yr", format: "currency2", getValue: (s) => s.equalizedAvgCostPsfYear },
    { type: "metric", label: "Notes", format: "text", getValue: (s) => s.notes || "• No notable notes extracted." },
  ];

  let row = 2;
  let shadeToggle = false;
  for (const item of rows) {
    if (item.type === "section") {
      sheet.mergeCells(row, 1, row, scenarioColCount + 1);
      const sectionCell = sheet.getCell(row, 1);
      sectionCell.value = item.label;
      sectionCell.font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos", size: 11 };
      sectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.black } };
      sectionCell.alignment = { horizontal: "left", vertical: "middle" };
      row += 1;
      shadeToggle = false;
      continue;
    }
    const labelCell = sheet.getCell(row, 1);
    labelCell.value = item.label;
    labelCell.font = { bold: true, color: { argb: BRAND_COLORS.text }, name: "Aptos", size: 10 };
    labelCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    const rowFill = shadeToggle ? BRAND_COLORS.lightGray : BRAND_COLORS.white;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };

    scenarios.forEach((scenario, idx) => {
      const valueCell = sheet.getCell(row, idx + 2);
      const value = item.getValue(scenario);
      valueCell.value = typeof value === "number" ? Number(value.toFixed(4)) : value;
      valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      applyCellFormat(valueCell, item.format);
      if (item.format === "text") {
        valueCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      }
    });

    if (item.label === "Notes") {
      const maxLines = Math.max(
        3,
        ...scenarios.map((scenario) => Math.min(12, (item.getValue(scenario).toString().split("\n").length)))
      );
      sheet.getRow(row).height = maxLines * 14;
    }
    shadeToggle = !shadeToggle;
    row += 1;
  }

  const endRow = row - 1;
  for (let r = 1; r <= endRow; r++) {
    for (let c = 1; c <= scenarioColCount + 1; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  for (let c = 2; c <= scenarioColCount + 1; c++) {
    for (let r = 1; r <= endRow; r++) {
      const cell = sheet.getCell(r, c);
      cell.border = {
        ...(cell.border ?? {}),
        left: c === 2 ? BORDER_MEDIUM.left : cell.border?.left ?? BORDER_THIN.left,
      };
    }
  }
  applyOuterBorder(sheet, 1, endRow, 1, scenarioColCount + 1);
  autoSizeColumns(sheet, 12, 40);
  sheet.getColumn(1).width = Math.max(34, sheet.getColumn(1).width ?? 34);
}

function createEqualizedSheet(workbook: ExcelJS.Workbook, usedNames: Set<string>, scenarios: WorkbookScenario[]): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Equalized Metrics", "Equalized Metrics", usedNames));
  setView(sheet, { xSplit: 1, ySplit: 6 });
  setSheetPrintSettings(sheet, { landscape: true, repeatHeaderRow: 6 });
  sheet.properties.defaultRowHeight = 22;

  const metrics = computeEqualizedMetrics(scenarios);
  const columnCount = scenarios.length + 1;
  sheet.getColumn(1).width = 40;
  for (let i = 0; i < scenarios.length; i++) sheet.getColumn(i + 2).width = 24;

  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getCell(1, 1).value = "EQUALIZED METRICS — Overlapping Lease Period";
  sheet.getCell(1, 1).font = { bold: true, color: { argb: BRAND_COLORS.white }, size: 14, name: "Aptos" };
  sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.black } };
  sheet.getCell(1, 1).alignment = { horizontal: "left", vertical: "middle" };

  sheet.mergeCells(2, 1, 2, columnCount);
  sheet.getCell(2, 1).value = "";
  sheet.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.accentRed } };
  sheet.getRow(2).height = 5;

  sheet.mergeCells(4, 1, 4, columnCount);
  if (!metrics.start || !metrics.end || metrics.end.getTime() < metrics.start.getTime()) {
    sheet.getCell(4, 1).value = "No overlapping lease term for equalized comparison.";
  } else {
    sheet.getCell(4, 1).value = `Equalized Period: ${formatDateMmDdYyyy(toIsoDate(metrics.start))} - ${formatDateMmDdYyyy(toIsoDate(metrics.end))}`;
  }
  sheet.getCell(4, 1).font = { bold: true, name: "Aptos", size: 11, color: { argb: BRAND_COLORS.text } };
  sheet.getCell(4, 1).alignment = { horizontal: "left", vertical: "middle" };

  sheet.getCell(6, 1).value = "Metric";
  sheet.getCell(6, 1).font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
  sheet.getCell(6, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(6, idx + 2);
    cell.value = scenario.name;
    cell.font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const rows: Array<{ label: string; format: CellFormat; getter: (scenario: WorkbookScenario) => number | string }> = [
    { label: "Equalized avg gross rent/SF/year", format: "currency2", getter: (s) => metrics.metrics[s.id]?.avgGrossRentPsfYear ?? 0 },
    { label: "Equalized avg gross rent/month", format: "currency0", getter: (s) => metrics.metrics[s.id]?.avgGrossRentMonth ?? 0 },
    { label: "Equalized avg cost/SF/year", format: "currency2", getter: (s) => metrics.metrics[s.id]?.avgCostPsfYear ?? 0 },
    { label: "Equalized avg cost/month", format: "currency0", getter: (s) => metrics.metrics[s.id]?.avgCostMonth ?? 0 },
    { label: "Equalized total cost", format: "currency0", getter: (s) => metrics.metrics[s.id]?.totalCost ?? 0 },
    { label: "Equalized NPV (t0=start)", format: "currency0", getter: (s) => metrics.metrics[s.id]?.npv ?? 0 },
  ];

  let row = 7;
  rows.forEach((rowDef, idx) => {
    const fill = idx % 2 === 0 ? BRAND_COLORS.white : BRAND_COLORS.lightGray;
    sheet.getCell(row, 1).value = rowDef.label;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: BRAND_COLORS.text }, name: "Aptos" };
    sheet.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    scenarios.forEach((scenario, cIdx) => {
      const cell = sheet.getCell(row, cIdx + 2);
      const value = rowDef.getter(scenario);
      cell.value = typeof value === "number" ? Number(value.toFixed(4)) : value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      applyCellFormat(cell, rowDef.format);
    });
    row += 1;
  });

  const endRow = row - 1;
  for (let r = 6; r <= endRow; r++) {
    for (let c = 1; c <= columnCount; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  applyOuterBorder(sheet, 6, endRow, 1, columnCount);
  autoSizeColumns(sheet, 12, 38);
}

function createMonthlyGrossMatrixSheet(workbook: ExcelJS.Workbook, usedNames: Set<string>, scenarios: WorkbookScenario[]): void {
  const sheet = workbook.addWorksheet(
    makeUniqueSheetName("Monthly Gross Cash Flow Matrix", "Monthly Gross Cash Flow Matrix", usedNames)
  );
  setView(sheet, { xSplit: 2, ySplit: 1 });
  setSheetPrintSettings(sheet, { landscape: true, repeatHeaderRow: 1 });
  sheet.properties.defaultRowHeight = 22;

  const allDates = scenarios
    .flatMap((scenario) => scenario.monthlyRows.map((row) => parseIsoDate(row.date)))
    .filter((date): date is Date => date !== null);
  if (allDates.length === 0) {
    sheet.getCell(1, 1).value = "No monthly cash flow data available.";
    return;
  }

  const start = new Date(Math.min(...allDates.map((date) => date.getTime())));
  const end = new Date(Math.max(...allDates.map((date) => date.getTime())));
  const timeline = buildMonthTimeline(start, end);

  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 14;
  scenarios.forEach((_, idx) => { sheet.getColumn(idx + 3).width = 22; });

  const headers = ["Month #", "Date", ...scenarios.map((scenario) => scenario.name)];
  headers.forEach((header, idx) => {
    const cell = sheet.getCell(1, idx + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
    cell.alignment = { horizontal: idx < 2 ? "center" : "left", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });

  const monthlyMaps = scenarios.map((scenario) => {
    const map = new Map<string, number>();
    scenario.monthlyRows.forEach((row) => map.set(row.date, row.totalCost));
    return map;
  });

  timeline.forEach((monthDate, idx) => {
    const row = idx + 2;
    const fill = idx % 2 === 0 ? BRAND_COLORS.white : BRAND_COLORS.lightGray;
    sheet.getCell(row, 1).value = idx + 1;
    sheet.getCell(row, 2).value = formatDateMmDdYyyy(toIsoDate(monthDate));
    sheet.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    sheet.getCell(row, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    sheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };

    scenarios.forEach((_, scenarioIdx) => {
      const col = scenarioIdx + 3;
      const cell = sheet.getCell(row, col);
      const iso = toIsoDate(monthDate);
      const value = monthlyMaps[scenarioIdx].get(iso);
      cell.value = value == null ? "—" : Number(value.toFixed(4));
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (value == null) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        applyCellFormat(cell, "currency0");
      }
    });
  });

  const endRow = timeline.length + 1;
  for (let r = 1; r <= endRow; r++) {
    for (let c = 1; c <= scenarios.length + 2; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  applyOuterBorder(sheet, 1, endRow, 1, scenarios.length + 2);
  autoSizeColumns(sheet, 10, 38);
}

function createAppendixSheet(workbook: ExcelJS.Workbook, usedNames: Set<string>, scenario: WorkbookScenario): void {
  const sheetName = makeUniqueSheetName(`Appendix — ${scenario.name}`, `Appendix ${scenario.name}`, usedNames);
  const sheet = workbook.addWorksheet(sheetName);
  setView(sheet, { ySplit: 5 });
  setSheetPrintSettings(sheet, { landscape: true, repeatHeaderRow: 5 });
  sheet.properties.defaultRowHeight = 22;

  sheet.columns = [
    { width: 10 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  sheet.mergeCells("A1:J2");
  const header = sheet.getCell("A1");
  header.value = `Appendix — ${scenario.name}`;
  header.font = { bold: true, size: 14, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.black } };
  header.alignment = { horizontal: "left", vertical: "middle" };

  sheet.mergeCells("A3:J3");
  const sub = sheet.getCell("A3");
  sub.value = `Detailed monthly cash flows | ${formatDateMmDdYyyy(scenario.commencementDate)} - ${formatDateMmDdYyyy(scenario.expirationDate)}`;
  sub.font = { bold: false, size: 10, color: { argb: BRAND_COLORS.text }, name: "Aptos" };
  sub.alignment = { horizontal: "left", vertical: "middle" };

  const headers = [
    "Month #",
    "Date",
    "Base Rent",
    "OpEx",
    "Parking",
    "TI Amort",
    "Concessions",
    "Gross Monthly",
    "Cumulative",
    "Discounted PV",
  ];
  headers.forEach((title, idx) => {
    const cell = sheet.getCell(5, idx + 1);
    cell.value = title;
    cell.font = { bold: true, color: { argb: BRAND_COLORS.white }, name: "Aptos" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER_THIN;
  });

  scenario.monthlyRows.forEach((rowValue, idx) => {
    const row = idx + 6;
    const fill = idx % 2 === 0 ? BRAND_COLORS.white : BRAND_COLORS.lightGray;
    const values: Array<string | number> = [
      rowValue.monthIndex + 1,
      formatDateMmDdYyyy(rowValue.date),
      rowValue.baseRent,
      rowValue.opex,
      rowValue.parking,
      rowValue.tiAmort,
      rowValue.concessions,
      rowValue.totalCost,
      rowValue.cumulativeCost,
      rowValue.discountedValue,
    ];
    values.forEach((value, colIdx) => {
      const cell = sheet.getCell(row, colIdx + 1);
      cell.value = typeof value === "number" ? Number(value.toFixed(4)) : value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (colIdx === 0) applyCellFormat(cell, "integer");
      else if (colIdx === 1) applyCellFormat(cell, "date");
      else applyCellFormat(cell, "currency0");
      cell.border = BORDER_THIN;
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    });
  });

  const endRow = scenario.monthlyRows.length + 5;
  applyOuterBorder(sheet, 5, endRow, 1, 10);
  autoSizeColumns(sheet, 10, 28);
}

function buildWorkbookInternal(
  scenarios: WorkbookScenario[],
  meta?: WorkbookBrandingMeta
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TheCREmodel";
  workbook.created = new Date();
  const usedNames = new Set<string>();

  createCoverSheet(workbook, usedNames, meta ?? {}, scenarios.length);
  createSummaryComparisonSheet(workbook, usedNames, scenarios);
  createEqualizedSheet(workbook, usedNames, scenarios);
  createMonthlyGrossMatrixSheet(workbook, usedNames, scenarios);
  scenarios.forEach((scenario) => createAppendixSheet(workbook, usedNames, scenario));

  return workbook.xlsx.writeBuffer() as Promise<ExcelJS.Buffer>;
}

export async function buildBrokerWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08,
  meta?: WorkbookBrandingMeta
): Promise<ExcelJS.Buffer> {
  const results: EngineResult[] = scenarios.map((scenario) => runMonthlyEngine(scenario, globalDiscountRate));
  const workbookScenarios = buildWorkbookScenariosFromCanonical(scenarios, results);
  return buildWorkbookInternal(workbookScenarios, meta);
}

export async function buildBrokerWorkbookFromCanonicalResponses(
  items: { response: CanonicalComputeResponse; scenarioName: string }[],
  meta?: WorkbookBrandingMeta
): Promise<ExcelJS.Buffer> {
  const workbookScenarios = buildWorkbookScenariosFromCanonicalResponses(items);
  return buildWorkbookInternal(workbookScenarios, meta);
}

export async function buildWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  return buildBrokerWorkbook(scenarios, globalDiscountRate);
}

export { buildWorkbookLegacy };
