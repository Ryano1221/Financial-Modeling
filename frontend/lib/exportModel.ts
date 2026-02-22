import ExcelJS from "exceljs";
import type { LeaseScenarioCanonical } from "@/lib/lease-engine/canonical-schema";
import type { EngineResult } from "@/lib/lease-engine/monthly-engine";
import { runMonthlyEngine } from "@/lib/lease-engine/monthly-engine";
import { buildWorkbook as buildWorkbookLegacy } from "@/lib/lease-engine/excel-export";
import type { CanonicalComputeResponse } from "@/lib/types";

export const TEMPLATE_VERSION = "3.0";

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

export interface WorkbookBrandingMeta {
  brokerageName?: string;
  clientName?: string;
  reportDate?: string;
  preparedBy?: string;
  market?: string;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
}

interface WorkbookMonthlyRow {
  monthIndex: number;
  date: string;
  baseRent: number;
  opex: number;
  parking: number;
  otherCosts: number;
  grossCashFlow: number;
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
  monthZeroGross: number;
  monthlyRows: WorkbookMonthlyRow[];
}

interface EqualizedMetrics {
  avgGrossRentPsfYear: number;
  avgGrossRentMonth: number;
  avgCostPsfYear: number;
  avgCostMonth: number;
  totalCost: number;
  npv: number;
}

const COLORS = {
  black: "FF000000",
  white: "FFFFFFFF",
  accentRed: "FFE10600",
  lightGray: "FFF2F2F2",
  darkGray: "FF1A1A1A",
  midGray: "FFD9D9D9",
  text: "FF101010",
  border: "FFB9B9B9",
};

const CURRENCY_0 = '"$"#,##0;[Red]-"$"#,##0';
const CURRENCY_2 = '"$"#,##0.00;[Red]-"$"#,##0.00';
const PERCENT_2 = "0.00%";

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

const BORDER_MEDIUM: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: COLORS.darkGray } },
  left: { style: "medium", color: { argb: COLORS.darkGray } },
  bottom: { style: "medium", color: { argb: COLORS.darkGray } },
  right: { style: "medium", color: { argb: COLORS.darkGray } },
};

const BORDER_THICK_TOP: Partial<ExcelJS.Borders> = {
  top: { style: "thick", color: { argb: COLORS.black } },
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

type CellFormat = "text" | "date" | "currency0" | "currency2" | "percent" | "integer";

type ParsedImage = {
  extension: "png" | "jpeg";
  dataUrl: string;
  width: number;
  height: number;
};

function normalizeText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function parseIsoDate(value?: string | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split(".").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function toIsoDate(date: Date): string {
  const y = `${date.getUTCFullYear()}`;
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateMmDdYyyy(value?: string | null): string {
  const date = parseIsoDate(value);
  if (!date) return normalizeText(value);
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  const yyyy = `${date.getUTCFullYear()}`;
  return `${mm}.${dd}.${yyyy}`;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function monthDiffInclusive(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
}

function monthKey(value?: string | null): string {
  const d = parseIsoDate(value);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, "0")}`;
}

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[\\/*?:\[\]]/g, "").trim();
  const base = cleaned || fallback;
  return base.slice(0, 31).trim() || fallback.slice(0, 31);
}

function makeUniqueSheetName(name: string, fallback: string, used: Set<string>): string {
  const base = sanitizeSheetName(name, fallback);
  let counter = 1;
  while (counter < 10000) {
    const suffix = counter === 1 ? "" : ` (${counter})`;
    const candidate = `${base.slice(0, Math.max(1, 31 - suffix.length)).trim()}${suffix}`;
    const key = candidate.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return candidate;
    }
    counter += 1;
  }
  const fallbackName = `${fallback}-${Date.now()}`.slice(0, 31);
  used.add(fallbackName.toLowerCase());
  return fallbackName;
}

function splitNoteFragments(raw: string): string[] {
  const text = normalizeText(raw);
  if (!text) return [];
  const normalized = text.replace(/\u2022/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split(/\n+|\s*\|\s*|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function classifyNoteCategory(text: string): string {
  for (const pattern of NOTE_CATEGORY_PATTERNS) {
    if (pattern.regex.test(text)) return pattern.label;
  }
  return "General";
}

function buildCategorizedNoteSummary(rawNotes: string): string {
  const fragments = splitNoteFragments(rawNotes);
  if (fragments.length === 0) return "• No notable clauses captured from extraction.";
  const grouped = new Map<string, string[]>();
  for (const fragment of fragments) {
    const key = classifyNoteCategory(fragment);
    const set = grouped.get(key) ?? [];
    const compact = fragment.replace(/\s+/g, " ").trim();
    if (!set.some((item) => item.toLowerCase() === compact.toLowerCase())) {
      set.push(compact);
      grouped.set(key, set);
    }
  }
  return Array.from(grouped.entries())
    .flatMap(([category, lines]) => lines.map((line) => `• ${category}: ${line}`))
    .join("\n");
}

function applyCellFormat(cell: ExcelJS.Cell, format: CellFormat): void {
  switch (format) {
    case "currency0":
      cell.numFmt = CURRENCY_0;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      break;
    case "currency2":
      cell.numFmt = CURRENCY_2;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      break;
    case "percent":
      cell.numFmt = PERCENT_2;
      cell.alignment = { horizontal: "right", vertical: "middle" };
      break;
    case "integer":
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
      break;
    case "date":
      cell.alignment = { horizontal: "center", vertical: "middle" };
      break;
    default:
      cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  }
}

function autoSizeColumns(sheet: ExcelJS.Worksheet, min = 10, max = 44): void {
  sheet.columns?.forEach((column) => {
    if (!column || typeof column.eachCell !== "function") return;
    let width = min;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const text = value == null ? "" : typeof value === "object" && "richText" in value && Array.isArray(value.richText)
        ? value.richText.map((x) => x.text).join("")
        : `${value}`;
      const longest = text.split("\n").reduce((a, b) => Math.max(a, b.length), 0);
      width = Math.max(width, longest + 2);
    });
    column.width = Math.min(max, width);
  });
}

function estimateWrappedLines(text: string, width: number): number {
  if (!text) return 1;
  const effectiveWidth = Math.max(6, Math.floor(width * 1.15));
  return text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / effectiveWidth)), 0);
}

function autoAdjustRowHeights(sheet: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    let maxLines = 1;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const wrap = cell.alignment?.wrapText;
      if (!wrap) return;
      const value = cell.value == null ? "" : `${cell.value}`;
      const width = sheet.getColumn(colNumber).width ?? 12;
      maxLines = Math.max(maxLines, estimateWrappedLines(value, width));
    });
    row.height = Math.max(20, maxLines * 14);
  }
}

function toColumnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function applyPrintSettings(sheet: ExcelJS.Worksheet, options: { landscape: boolean; lastRow: number; lastCol: number; repeatRow?: number }): void {
  sheet.views = [{
    ...(sheet.views?.[0] ?? {}),
    showGridLines: false,
  }];
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: options.landscape ? "landscape" : "portrait",
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
    printArea: `A1:${toColumnLetter(options.lastCol)}${options.lastRow}`,
  };
  if (options.repeatRow) {
    const setup = sheet.pageSetup as unknown as { printTitlesRow?: string };
    setup.printTitlesRow = `${options.repeatRow}:${options.repeatRow}`;
  }
}

function applyOuterBorder(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, startCol: number, endCol: number): void {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(r, c);
      const base = { ...(cell.border ?? {}) };
      if (r === startRow) base.top = { style: "medium", color: { argb: COLORS.black } };
      if (r === endRow) base.bottom = { style: "medium", color: { argb: COLORS.black } };
      if (c === startCol) base.left = { style: "medium", color: { argb: COLORS.black } };
      if (c === endCol) base.right = { style: "medium", color: { argb: COLORS.black } };
      cell.border = base;
    }
  }
}

function decodeBase64(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(cleaned, "base64"));
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (length < 2) break;
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
      if (width > 0 && height > 0) return { width, height };
      break;
    }
    offset += 2 + length;
  }
  return null;
}

function parseImageDataUrl(dataUrl?: string | null): ParsedImage | null {
  const raw = String(dataUrl ?? "").trim();
  if (!raw.startsWith("data:image/")) return null;
  const match = raw.match(/^data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  const extension: "png" | "jpeg" | null =
    subtype === "png" ? "png" : (subtype === "jpg" || subtype === "jpeg" ? "jpeg" : null);
  if (!extension) return null;
  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;
  const bytes = decodeBase64(base64);
  const dims = extension === "png" ? parsePngDimensions(bytes) : parseJpegDimensions(bytes);
  return {
    extension,
    dataUrl: `data:image/${extension};base64,${base64}`,
    width: dims?.width ?? 400,
    height: dims?.height ?? 120,
  };
}

function placeImageInBox(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  parsed: ParsedImage | null,
  box: { col: number; row: number; widthPx: number; heightPx: number }
): boolean {
  if (!parsed) return false;
  const ratio = parsed.width / Math.max(1, parsed.height);
  let targetWidth = box.widthPx;
  let targetHeight = Math.floor(targetWidth / ratio);
  if (targetHeight > box.heightPx) {
    targetHeight = box.heightPx;
    targetWidth = Math.floor(targetHeight * ratio);
  }
  const imageId = workbook.addImage({ base64: parsed.dataUrl, extension: parsed.extension });
  sheet.addImage(imageId, {
    tl: { col: box.col - 1 + 0.05, row: box.row - 1 + 0.05 },
    ext: { width: Math.max(20, targetWidth), height: Math.max(20, targetHeight) },
  });
  return true;
}

function applyBrandHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  meta: WorkbookBrandingMeta,
  totalCols: number,
  sectionTitle: string,
  sectionSubtitle: string
): number {
  sheet.mergeCells(1, 1, 2, totalCols);
  const top = sheet.getCell(1, 1);
  top.value = `${sectionTitle}\n${sectionSubtitle}`;
  top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  top.font = { name: "Aptos", bold: true, size: 13, color: { argb: COLORS.white } };
  top.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 24;

  const brokerageLogo = parseImageDataUrl(meta.brokerageLogoDataUrl);
  const clientLogo = parseImageDataUrl(meta.clientLogoDataUrl);
  const brokerageName = normalizeText(meta.brokerageName, "theCREmodel");
  const clientName = normalizeText(meta.clientName, "Client");

  const leftEndCol = Math.max(1, Math.floor(totalCols / 2));
  const rightStartCol = leftEndCol + 1;
  const pxPerCol = 64;
  placeImageInBox(workbook, sheet, brokerageLogo, {
    col: 1,
    row: 3,
    widthPx: Math.max(80, leftEndCol * pxPerCol - 12),
    heightPx: 44,
  });
  if (rightStartCol <= totalCols) {
    placeImageInBox(workbook, sheet, clientLogo, {
      col: rightStartCol,
      row: 3,
      widthPx: Math.max(80, (totalCols - rightStartCol + 1) * pxPerCol - 12),
      heightPx: 44,
    });
  }

  sheet.mergeCells(3, 1, 3, leftEndCol);
  const brokerageCell = sheet.getCell(3, 1);
  brokerageCell.value = brokerageLogo ? "" : brokerageName;
  brokerageCell.font = { name: "Aptos", size: 11, bold: true, color: { argb: COLORS.text } };
  brokerageCell.alignment = { horizontal: "left", vertical: "middle" };

  if (rightStartCol <= totalCols) {
    sheet.mergeCells(3, rightStartCol, 3, totalCols);
    const clientCell = sheet.getCell(3, rightStartCol);
    clientCell.value = clientLogo ? "" : clientName;
    clientCell.font = { name: "Aptos", size: 11, bold: true, color: { argb: COLORS.text } };
    clientCell.alignment = { horizontal: "right", vertical: "middle" };
  }

  for (let c = 1; c <= totalCols; c++) {
    const borderCell = sheet.getCell(3, c);
    borderCell.border = { ...BORDER_THIN };
  }
  sheet.getRow(3).height = 28;
  return 5;
}

function buildScenariosFromCanonical(scenarios: LeaseScenarioCanonical[], results: EngineResult[]): WorkbookScenario[] {
  return scenarios.map((scenario, idx) => {
    const result = results[idx];
    const monthlyRows: WorkbookMonthlyRow[] = result.monthly.map((m) => ({
      monthIndex: m.monthIndex,
      date: m.periodStart,
      baseRent: m.baseRent,
      opex: m.opex,
      parking: m.parking,
      otherCosts: (m.misc ?? 0) + (m.tiAmortization ?? 0),
      grossCashFlow: m.total,
      cumulativeCost: m.cumulativeCost,
      discountedValue: m.discountedValue,
    }));
    const monthlyGrossSum = monthlyRows.reduce((sum, row) => sum + row.grossCashFlow, 0);
    const monthZeroResidual = Math.max(0, result.metrics.totalObligation - monthlyGrossSum);
    const parkingPreTax = result.metrics.parkingCostPerSpotMonthlyPreTax
      ?? safeDiv(result.metrics.parkingCostPerSpotMonthly, 1 + (result.metrics.parkingSalesTaxPercent || 0));
    return {
      id: scenario.id,
      name: normalizeText(result.scenarioName, scenario.name),
      documentType: "Lease",
      buildingName: normalizeText(result.metrics.buildingName, scenario.partyAndPremises.premisesLabel ?? scenario.partyAndPremises.premisesName),
      suiteFloor: normalizeText(result.metrics.suiteName, scenario.partyAndPremises.floorsOrSuite ?? ""),
      streetAddress: normalizeText(scenario.partyAndPremises.premisesName),
      rsf: result.metrics.rsf,
      leaseType: normalizeText(result.metrics.leaseType).toUpperCase(),
      termMonths: result.metrics.termMonths,
      commencementDate: result.metrics.commencementDate,
      expirationDate: result.metrics.expirationDate,
      rentNominal: monthlyRows.reduce((sum, row) => sum + row.baseRent, 0),
      opexNominal: monthlyRows.reduce((sum, row) => sum + row.opex, 0),
      opexEscalationPct: scenario.expenseSchedule.annualEscalationPercent ?? 0,
      discountRate: result.metrics.discountRateUsed,
      parkingCostPerSpotPreTax: parkingPreTax || 0,
      parkingSalesTaxPct: result.metrics.parkingSalesTaxPercent ?? 0.0825,
      parkingCostPerSpotAfterTax: result.metrics.parkingCostPerSpotMonthly ?? 0,
      parkingCostAnnual: result.metrics.parkingCostAnnual ?? 0,
      tiBudget: scenario.tiSchedule.budgetTotal ?? 0,
      tiAllowance: scenario.tiSchedule.allowanceFromLandlord ?? 0,
      tiOutOfPocket: Math.max(0, scenario.tiSchedule.outOfPocket ?? 0),
      totalObligation: result.metrics.totalObligation,
      npvCost: result.metrics.npvAtDiscount,
      avgCostYear: result.metrics.avgAllInCostPerYear,
      avgCostPsfYear: result.metrics.avgCostPsfYr,
      equalizedAvgCostPsfYear: result.metrics.equalizedAvgCostPsfYr,
      notes: buildCategorizedNoteSummary(`${scenario.notes ?? ""}\n${result.metrics.notes ?? ""}`.trim()),
      monthZeroGross: monthZeroResidual,
      monthlyRows,
    };
  });
}

function buildScenariosFromCanonicalResponses(items: { response: CanonicalComputeResponse; scenarioName: string }[]): WorkbookScenario[] {
  return items.map((item, idx) => {
    const c = item.response.normalized_canonical_lease;
    const m = item.response.metrics;
    const monthlyRows: WorkbookMonthlyRow[] = item.response.monthly_rows.map((row) => ({
      monthIndex: row.month_index,
      date: row.date,
      baseRent: row.base_rent,
      opex: row.opex,
      parking: row.parking,
      otherCosts: (row.ti_amort ?? 0) + (row.concessions ?? 0),
      grossCashFlow: row.total_cost,
      cumulativeCost: row.cumulative_cost,
      discountedValue: row.discounted_value,
    }));
    const monthlyGrossSum = monthlyRows.reduce((sum, row) => sum + row.grossCashFlow, 0);
    const monthZeroResidual = Math.max(0, (m.total_obligation_nominal ?? 0) - monthlyGrossSum);
    const parkingPreTax = c.parking_rate_monthly ?? 0;
    const parkingTax = c.parking_sales_tax_rate ?? 0.0825;
    const notesText = [
      m.notes ?? "",
      String(c.notes ?? ""),
      ...(item.response.assumptions ?? []),
      ...(item.response.warnings ?? []),
    ].filter(Boolean).join(". ");
    return {
      id: `canonical-${idx + 1}`,
      name: normalizeText(item.scenarioName, `Scenario ${idx + 1}`),
      documentType: normalizeText(c.document_type_detected, "Lease"),
      buildingName: normalizeText(m.building_name, c.building_name ?? m.premises_name),
      suiteFloor: normalizeText([m.suite || c.suite || "", m.floor || c.floor ? `Floor ${m.floor || c.floor}` : ""].filter(Boolean).join(" / ")),
      streetAddress: normalizeText(m.address, c.address ?? ""),
      rsf: m.rsf ?? 0,
      leaseType: normalizeText(m.lease_type, c.lease_type ?? "").toUpperCase(),
      termMonths: m.term_months ?? 0,
      commencementDate: m.commencement_date ?? "",
      expirationDate: m.expiration_date ?? "",
      rentNominal: m.base_rent_total ?? 0,
      opexNominal: m.opex_total ?? 0,
      opexEscalationPct: c.opex_growth_rate ?? 0,
      discountRate: m.discount_rate_annual ?? 0.08,
      parkingCostPerSpotPreTax: parkingPreTax,
      parkingSalesTaxPct: parkingTax,
      parkingCostPerSpotAfterTax: parkingPreTax * (1 + parkingTax),
      parkingCostAnnual: m.parking_total ?? 0,
      tiBudget: m.ti_value_total ?? 0,
      tiAllowance: m.ti_value_total ?? 0,
      tiOutOfPocket: 0,
      totalObligation: m.total_obligation_nominal ?? 0,
      npvCost: m.npv_cost ?? 0,
      avgCostYear: safeDiv(m.total_obligation_nominal ?? 0, Math.max(1, (m.term_months ?? 1) / 12)),
      avgCostPsfYear: m.avg_all_in_cost_psf_year ?? 0,
      equalizedAvgCostPsfYear: m.equalized_avg_cost_psf_year ?? 0,
      notes: buildCategorizedNoteSummary(notesText),
      monthZeroGross: monthZeroResidual,
      monthlyRows,
    };
  });
}

function computeEqualizedWindow(scenarios: WorkbookScenario[]): { start: Date | null; end: Date | null } {
  const starts = scenarios.map((s) => parseIsoDate(s.commencementDate)).filter((d): d is Date => d !== null);
  const ends = scenarios.map((s) => parseIsoDate(s.expirationDate)).filter((d): d is Date => d !== null);
  if (starts.length === 0 || ends.length === 0) return { start: null, end: null };
  const start = new Date(Math.max(...starts.map((d) => d.getTime())));
  const end = new Date(Math.min(...ends.map((d) => d.getTime())));
  return { start, end };
}

function computeEqualizedMetrics(scenario: WorkbookScenario, start: Date, end: Date): EqualizedMetrics {
  const rows = scenario.monthlyRows.filter((row) => {
    const date = parseIsoDate(row.date);
    if (!date) return false;
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  });
  const monthCount = Math.max(1, rows.length);
  const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const annualFactor = days / 365;
  const gross = rows.reduce((sum, row) => sum + row.baseRent + row.opex + row.parking, 0);
  const recurring = rows.reduce((sum, row) => sum + row.grossCashFlow, 0);
  const rate = Math.pow(1 + (scenario.discountRate || 0.08), 1 / 12) - 1;
  const npv = rows.reduce((sum, row, idx) => sum + row.grossCashFlow / Math.pow(1 + rate, idx), 0);
  return {
    avgGrossRentPsfYear: safeDiv(gross, Math.max(1, scenario.rsf) * annualFactor),
    avgGrossRentMonth: safeDiv(gross, monthCount),
    avgCostPsfYear: safeDiv(recurring, Math.max(1, scenario.rsf) * annualFactor),
    avgCostMonth: safeDiv(recurring, monthCount),
    totalCost: recurring,
    npv,
  };
}

function createCoverSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Cover", "Cover", usedSheetNames));
  sheet.columns = Array.from({ length: 12 }, () => ({ width: 14 }));
  sheet.views = [{ showGridLines: false }];
  sheet.properties.defaultRowHeight = 24;

  sheet.mergeCells(1, 1, 3, 12);
  const titleBand = sheet.getCell(1, 1);
  titleBand.value = "THE COMMERCIAL REAL ESTATE MODEL\nLease Financial Analysis";
  titleBand.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  titleBand.font = { name: "Aptos", bold: true, size: 24, color: { argb: COLORS.white } };
  titleBand.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  const reportDate = formatDateMmDdYyyy(meta.reportDate ?? toIsoDate(new Date()));
  const brokerage = normalizeText(meta.brokerageName, "theCREmodel");
  const client = normalizeText(meta.clientName, "Client");
  const preparedBy = normalizeText(meta.preparedBy, "theCREmodel");
  const market = normalizeText(meta.market, "");

  const brokerageLogo = parseImageDataUrl(meta.brokerageLogoDataUrl);
  const clientLogo = parseImageDataUrl(meta.clientLogoDataUrl);
  placeImageInBox(workbook, sheet, brokerageLogo, { col: 1, row: 4, widthPx: 280, heightPx: 80 });

  if (!brokerageLogo) {
    sheet.mergeCells(4, 1, 6, 4);
    const cell = sheet.getCell(4, 1);
    cell.value = brokerage;
    cell.font = { name: "Aptos", bold: true, size: 15, color: { argb: COLORS.text } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  type CoverBlock = {
    label: string;
    value: string;
    colStart: number;
    colEnd: number;
    rowStart: number;
    rowEnd: number;
    logo?: ParsedImage | null;
    valueAlignment?: "left" | "right" | "center";
  };
  const blocks: CoverBlock[] = [
    { label: "Prepared For", value: client, colStart: 1, colEnd: 4, rowStart: 8, rowEnd: 10, logo: clientLogo },
    { label: "Prepared By", value: preparedBy, colStart: 5, colEnd: 8, rowStart: 8, rowEnd: 10 },
    { label: "Report Date", value: reportDate, colStart: 9, colEnd: 12, rowStart: 8, rowEnd: 10 },
    { label: "Market", value: market || "—", colStart: 1, colEnd: 4, rowStart: 12, rowEnd: 13 },
    { label: "Scenario Count", value: `${scenarios.length}`, colStart: 5, colEnd: 8, rowStart: 12, rowEnd: 13 },
  ];

  for (const block of blocks) {
    sheet.mergeCells(block.rowStart, block.colStart, block.rowEnd, block.colEnd);
    const cell = sheet.getCell(block.rowStart, block.colStart);
    const label = block.label.toUpperCase();
    const showValueText = !(block.label === "Prepared For" && block.logo);
    cell.value = showValueText
      ? {
          richText: [
            { text: `${label}\n`, font: { name: "Aptos", bold: true, size: 10, color: { argb: COLORS.darkGray } } },
            { text: block.value, font: { name: "Aptos", bold: true, size: 12, color: { argb: COLORS.text } } },
          ],
        }
      : {
          richText: [
            { text: label, font: { name: "Aptos", bold: true, size: 10, color: { argb: COLORS.darkGray } } },
          ],
        };
    cell.alignment = {
      horizontal: block.valueAlignment ?? "left",
      vertical: "top",
      wrapText: true,
    };
    for (let r = block.rowStart; r <= block.rowEnd; r++) {
      for (let c = block.colStart; c <= block.colEnd; c++) {
        sheet.getCell(r, c).border = { ...BORDER_THIN };
      }
    }
    if (block.label === "Prepared For" && block.logo) {
      placeImageInBox(workbook, sheet, block.logo, {
        col: block.colStart,
        row: block.rowStart + 1,
        widthPx: Math.max(90, (block.colEnd - block.colStart + 1) * 62 - 12),
        heightPx: 40,
      });
    }
  }

  const footerRow = 15;
  sheet.mergeCells(footerRow, 1, footerRow, 12);
  const footer = sheet.getCell(footerRow, 1);
  footer.value = `Template Version ${TEMPLATE_VERSION}`;
  footer.alignment = { horizontal: "center", vertical: "middle" };
  footer.font = { name: "Aptos", size: 10, color: { argb: "FF666666" } };

  autoAdjustRowHeights(sheet, 1, footerRow);
  applyPrintSettings(sheet, { landscape: false, lastRow: footerRow, lastCol: 12 });
}

function createSummarySheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Summary Comparison", "Summary Comparison", usedSheetNames));
  const cols = scenarios.length + 1;
  sheet.getColumn(1).width = 38;
  for (let i = 0; i < scenarios.length; i++) sheet.getColumn(i + 2).width = 24;

  const startRow = applyBrandHeader(workbook, sheet, meta, cols, "SUMMARY COMPARISON", "Institutional scenario matrix");

  sheet.getCell(startRow, 1).value = "Metric";
  sheet.getCell(startRow, 1).font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
  sheet.getCell(startRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(startRow, idx + 2);
    cell.value = scenario.name;
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  type SummaryRow =
    | { type: "section"; label: string }
    | { type: "metric"; label: string; format: CellFormat; getter: (s: WorkbookScenario) => string | number };
  const rows: SummaryRow[] = [
    { type: "section", label: "PREMISES" },
    { type: "metric", label: "Document type", format: "text", getter: (s) => s.documentType },
    { type: "metric", label: "Building name", format: "text", getter: (s) => s.buildingName },
    { type: "metric", label: "Suite / floor", format: "text", getter: (s) => s.suiteFloor },
    { type: "metric", label: "Street address", format: "text", getter: (s) => s.streetAddress },
    { type: "metric", label: "RSF", format: "integer", getter: (s) => s.rsf },
    { type: "metric", label: "Commencement", format: "date", getter: (s) => formatDateMmDdYyyy(s.commencementDate) },
    { type: "metric", label: "Expiration", format: "date", getter: (s) => formatDateMmDdYyyy(s.expirationDate) },
    { type: "section", label: "RENT STRUCTURE" },
    { type: "metric", label: "Lease type", format: "text", getter: (s) => s.leaseType },
    { type: "metric", label: "Term (months)", format: "integer", getter: (s) => s.termMonths },
    { type: "metric", label: "Rent (nominal)", format: "currency0", getter: (s) => s.rentNominal },
    { type: "metric", label: "OpEx (nominal)", format: "currency0", getter: (s) => s.opexNominal },
    { type: "metric", label: "OpEx escalation %", format: "percent", getter: (s) => s.opexEscalationPct },
    { type: "metric", label: "Discount rate", format: "percent", getter: (s) => s.discountRate },
    { type: "section", label: "PARKING" },
    { type: "metric", label: "Parking cost ($/spot/month, pre-tax)", format: "currency0", getter: (s) => s.parkingCostPerSpotPreTax },
    { type: "metric", label: "Parking sales tax %", format: "percent", getter: (s) => s.parkingSalesTaxPct },
    { type: "metric", label: "Parking cost ($/spot/month, after tax)", format: "currency0", getter: (s) => s.parkingCostPerSpotAfterTax },
    { type: "metric", label: "Parking cost (annual)", format: "currency0", getter: (s) => s.parkingCostAnnual },
    { type: "section", label: "TI / CAPEX" },
    { type: "metric", label: "TI budget", format: "currency0", getter: (s) => s.tiBudget },
    { type: "metric", label: "TI allowance", format: "currency0", getter: (s) => s.tiAllowance },
    { type: "metric", label: "TI out of pocket", format: "currency0", getter: (s) => s.tiOutOfPocket },
    { type: "section", label: "SUMMARY METRICS" },
    { type: "metric", label: "Total obligation", format: "currency0", getter: (s) => s.totalObligation },
    { type: "metric", label: "NPV cost", format: "currency0", getter: (s) => s.npvCost },
    { type: "metric", label: "Avg cost/year", format: "currency0", getter: (s) => s.avgCostYear },
    { type: "metric", label: "Avg cost/SF/year", format: "currency2", getter: (s) => s.avgCostPsfYear },
    { type: "metric", label: "Equalized avg cost/RSF/yr", format: "currency2", getter: (s) => s.equalizedAvgCostPsfYear },
    { type: "metric", label: "Notes", format: "text", getter: (s) => s.notes },
  ];

  let row = startRow + 1;
  let shade = false;
  for (const def of rows) {
    if (def.type === "section") {
      sheet.mergeCells(row, 1, row, cols);
      const cell = sheet.getCell(row, 1);
      cell.value = def.label;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
      cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white }, size: 11 };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      row += 1;
      shade = false;
      continue;
    }

    const rowFill = shade ? COLORS.lightGray : COLORS.white;
    const labelCell = sheet.getCell(row, 1);
    labelCell.value = def.label;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
    labelCell.font = { name: "Aptos", bold: true, color: { argb: COLORS.text }, size: 10 };
    labelCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    scenarios.forEach((scenario, idx) => {
      const value = def.getter(scenario);
      const cell = sheet.getCell(row, idx + 2);
      cell.value = typeof value === "number" ? Number(value.toFixed(6)) : value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFill } };
      applyCellFormat(cell, def.format);
      if (def.format === "text") {
        cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      }
    });
    shade = !shade;
    row += 1;
  }
  const endRow = row - 1;

  for (let r = startRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  applyOuterBorder(sheet, startRow, endRow, 1, cols);

  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: startRow, showGridLines: false }];
  autoSizeColumns(sheet, 10, 40);
  sheet.getColumn(1).width = Math.max(36, sheet.getColumn(1).width ?? 36);
  autoAdjustRowHeights(sheet, startRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: cols, repeatRow: startRow });
}

function createEqualizedSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Equalized Metrics", "Equalized Metrics", usedSheetNames));
  const cols = scenarios.length + 1;
  sheet.getColumn(1).width = 42;
  for (let i = 0; i < scenarios.length; i++) sheet.getColumn(i + 2).width = 24;

  const startRow = applyBrandHeader(workbook, sheet, meta, cols, "EQUALIZED METRICS", "Shared overlap period calculations");
  const window = computeEqualizedWindow(scenarios);

  sheet.mergeCells(startRow, 1, startRow, cols);
  const periodCell = sheet.getCell(startRow, 1);
  periodCell.value = (window.start && window.end && window.end.getTime() >= window.start.getTime())
    ? `Equalized Period: ${formatDateMmDdYyyy(toIsoDate(window.start))} - ${formatDateMmDdYyyy(toIsoDate(window.end))}`
    : "No overlapping lease term for equalized comparison.";
  periodCell.font = { name: "Aptos", bold: true, size: 11, color: { argb: COLORS.text } };
  periodCell.alignment = { horizontal: "left", vertical: "middle" };
  periodCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
  rowBorderFill(sheet, startRow, 1, cols);

  const headerRow = startRow + 2;
  sheet.getCell(headerRow, 1).value = "Metric";
  sheet.getCell(headerRow, 1).font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
  sheet.getCell(headerRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(headerRow, idx + 2);
    cell.value = scenario.name;
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const metricsRows: Array<{
    label: string;
    format: CellFormat;
    getter: (scenario: WorkbookScenario) => number | string;
  }> = [
    {
      label: "Equalized avg gross rent/SF/year",
      format: "currency2",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).avgGrossRentPsfYear
        : "—",
    },
    {
      label: "Equalized avg gross rent/month",
      format: "currency0",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).avgGrossRentMonth
        : "—",
    },
    {
      label: "Equalized avg cost/SF/year",
      format: "currency2",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).avgCostPsfYear
        : "—",
    },
    {
      label: "Equalized avg cost/month",
      format: "currency0",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).avgCostMonth
        : "—",
    },
    {
      label: "Equalized total cost",
      format: "currency0",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).totalCost
        : "—",
    },
    {
      label: "Equalized NPV (t0=start)",
      format: "currency0",
      getter: (scenario) => (window.start && window.end && window.end.getTime() >= window.start.getTime())
        ? computeEqualizedMetrics(scenario, window.start, window.end).npv
        : "—",
    },
  ];

  let row = headerRow + 1;
  metricsRows.forEach((metric, idx) => {
    const fill = idx % 2 === 0 ? COLORS.white : COLORS.lightGray;
    const label = sheet.getCell(row, 1);
    label.value = metric.label;
    label.font = { name: "Aptos", bold: true, color: { argb: COLORS.text } };
    label.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    scenarios.forEach((scenario, cIdx) => {
      const cell = sheet.getCell(row, cIdx + 2);
      const value = metric.getter(scenario);
      cell.value = typeof value === "number" ? Number(value.toFixed(6)) : value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (typeof value === "number") applyCellFormat(cell, metric.format);
      else cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    row += 1;
  });

  const endRow = row - 1;
  for (let r = headerRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      sheet.getCell(r, c).border = { ...(sheet.getCell(r, c).border ?? {}), ...BORDER_THIN };
    }
  }
  applyOuterBorder(sheet, headerRow, endRow, 1, cols);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  autoSizeColumns(sheet, 12, 38);
  autoAdjustRowHeights(sheet, startRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: cols, repeatRow: headerRow });
}

function createMonthlyGrossMatrixSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(
    makeUniqueSheetName("Monthly Gross Cash Flow Matrix", "Monthly Gross Cash Flow Matrix", usedSheetNames)
  );
  const cols = scenarios.length + 2;
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 14;
  for (let i = 0; i < scenarios.length; i++) sheet.getColumn(i + 3).width = 22;

  const startRow = applyBrandHeader(workbook, sheet, meta, cols, "MONTHLY GROSS CASH FLOW MATRIX", "Institutional side-by-side monthly totals");
  const headerRow = startRow;
  sheet.getCell(headerRow, 1).value = "Month #";
  sheet.getCell(headerRow, 2).value = "Date";
  for (let c = 1; c <= 2; c++) {
    const cell = sheet.getCell(headerRow, c);
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(headerRow, idx + 3);
    cell.value = scenario.name;
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const starts = scenarios.map((s) => parseIsoDate(s.commencementDate)).filter((d): d is Date => d !== null);
  const ends = scenarios.map((s) => parseIsoDate(s.expirationDate)).filter((d): d is Date => d !== null);
  const earliest = starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : new Date();
  const latest = ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : earliest;
  const months = Math.max(0, monthDiffInclusive(earliest, latest));

  const monthlyMaps = scenarios.map((scenario) => {
    const map = new Map<string, number>();
    scenario.monthlyRows.forEach((row) => map.set(monthKey(row.date), row.grossCashFlow));
    return map;
  });

  let row = headerRow + 1;
  const month0Row = row;
  sheet.getCell(row, 1).value = 0;
  sheet.getCell(row, 2).value = "PRE COMMENCEMENT";
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(row, idx + 3);
    cell.value = Number(scenario.monthZeroGross.toFixed(4));
    applyCellFormat(cell, "currency0");
  });
  row += 1;

  for (let monthOffset = 0; monthOffset < months; monthOffset++) {
    const date = addMonths(earliest, monthOffset);
    const key = monthKey(toIsoDate(date));
    const displayDate = formatDateMmDdYyyy(toIsoDate(date));
    const fill = monthOffset % 2 === 0 ? COLORS.white : COLORS.lightGray;
    sheet.getCell(row, 1).value = monthOffset + 1;
    sheet.getCell(row, 2).value = displayDate;
    sheet.getCell(row, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    sheet.getCell(row, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    sheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };

    scenarios.forEach((scenario, idx) => {
      const start = parseIsoDate(scenario.commencementDate);
      const end = parseIsoDate(scenario.expirationDate);
      const active = start && end ? (date.getTime() >= addMonths(start, 0).getTime() && date.getTime() <= addMonths(end, 0).getTime()) : false;
      const value = active ? monthlyMaps[idx].get(key) : undefined;
      const cell = sheet.getCell(row, idx + 3);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (value == null || Number.isNaN(value)) {
        cell.value = "—";
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.value = Number(value.toFixed(4));
        applyCellFormat(cell, "currency0");
      }
    });
    row += 1;
  }

  const totalRow = row;
  sheet.getCell(totalRow, 1).value = "";
  sheet.getCell(totalRow, 2).value = "Total Estimated Obligation";
  sheet.getCell(totalRow, 2).font = { name: "Aptos", bold: true, color: { argb: COLORS.text } };
  sheet.getCell(totalRow, 2).alignment = { horizontal: "left", vertical: "middle" };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(totalRow, idx + 3);
    const colLetter = toColumnLetter(idx + 3);
    cell.value = { formula: `SUM(${colLetter}${month0Row}:${colLetter}${totalRow - 1})` };
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.text } };
    applyCellFormat(cell, "currency0");
  });
  for (let c = 1; c <= cols; c++) {
    const cell = sheet.getCell(totalRow, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
    cell.border = { ...(cell.border ?? {}), ...BORDER_THICK_TOP, ...BORDER_THIN };
  }

  const endRow = totalRow;
  for (let r = headerRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  applyOuterBorder(sheet, headerRow, endRow, 1, cols);
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: headerRow, showGridLines: false }];
  autoSizeColumns(sheet, 10, 34);
  autoAdjustRowHeights(sheet, headerRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: cols, repeatRow: headerRow });
}

function createAppendixSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenario: WorkbookScenario,
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(
    makeUniqueSheetName(`Appendix — ${scenario.name}`, `Appendix ${scenario.name}`, usedSheetNames)
  );
  const cols = 9;
  const widths = [10, 14, 14, 14, 14, 14, 16, 16, 16];
  widths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w; });

  const startRow = applyBrandHeader(workbook, sheet, meta, cols, "APPENDIX — MONTHLY CASH FLOWS", scenario.name);
  sheet.mergeCells(startRow, 1, startRow, cols);
  const scenarioMetaCell = sheet.getCell(startRow, 1);
  scenarioMetaCell.value = `${scenario.buildingName} | ${scenario.suiteFloor} | ${formatDateMmDdYyyy(scenario.commencementDate)} - ${formatDateMmDdYyyy(scenario.expirationDate)}`;
  scenarioMetaCell.font = { name: "Aptos", bold: true, size: 10, color: { argb: COLORS.text } };
  scenarioMetaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
  scenarioMetaCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  rowBorderFill(sheet, startRow, 1, cols);

  const headerRow = startRow + 2;
  const headers = [
    "Month #",
    "Date",
    "Base Rent",
    "OpEx",
    "Parking",
    "Other Costs",
    "Gross Cash Flow",
    "Cumulative",
    "Present Value",
  ];
  headers.forEach((h, idx) => {
    const cell = sheet.getCell(headerRow, idx + 1);
    cell.value = h;
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.darkGray } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  let row = headerRow + 1;
  sheet.getCell(row, 1).value = 0;
  sheet.getCell(row, 2).value = "PRE COMMENCEMENT";
  sheet.getCell(row, 3).value = 0;
  sheet.getCell(row, 4).value = 0;
  sheet.getCell(row, 5).value = 0;
  sheet.getCell(row, 6).value = Number(scenario.monthZeroGross.toFixed(4));
  sheet.getCell(row, 7).value = Number(scenario.monthZeroGross.toFixed(4));
  sheet.getCell(row, 8).value = Number(scenario.monthZeroGross.toFixed(4));
  sheet.getCell(row, 9).value = Number(scenario.monthZeroGross.toFixed(4));
  for (let c = 1; c <= cols; c++) {
    if (c >= 3) applyCellFormat(sheet.getCell(row, c), "currency0");
    else applyCellFormat(sheet.getCell(row, c), c === 1 ? "integer" : "date");
  }
  row += 1;

  scenario.monthlyRows.forEach((m, idx) => {
    const fill = idx % 2 === 0 ? COLORS.white : COLORS.lightGray;
    sheet.getCell(row, 1).value = m.monthIndex + 1;
    sheet.getCell(row, 2).value = formatDateMmDdYyyy(m.date);
    sheet.getCell(row, 3).value = Number(m.baseRent.toFixed(4));
    sheet.getCell(row, 4).value = Number(m.opex.toFixed(4));
    sheet.getCell(row, 5).value = Number(m.parking.toFixed(4));
    sheet.getCell(row, 6).value = Number(m.otherCosts.toFixed(4));
    sheet.getCell(row, 7).value = Number(m.grossCashFlow.toFixed(4));
    sheet.getCell(row, 8).value = Number(m.cumulativeCost.toFixed(4));
    sheet.getCell(row, 9).value = Number(m.discountedValue.toFixed(4));
    for (let c = 1; c <= cols; c++) {
      const cell = sheet.getCell(row, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (c === 1) applyCellFormat(cell, "integer");
      else if (c === 2) applyCellFormat(cell, "date");
      else applyCellFormat(cell, "currency0");
    }
    row += 1;
  });

  const totalsRow = row;
  sheet.getCell(totalsRow, 1).value = "";
  sheet.getCell(totalsRow, 2).value = "Totals";
  sheet.getCell(totalsRow, 2).font = { name: "Aptos", bold: true, color: { argb: COLORS.text } };
  sheet.getCell(totalsRow, 2).alignment = { horizontal: "left", vertical: "middle" };
  for (let c = 3; c <= cols; c++) {
    const col = toColumnLetter(c);
    const cell = sheet.getCell(totalsRow, c);
    cell.value = { formula: `SUM(${col}${headerRow + 1}:${col}${totalsRow - 1})` };
    cell.font = { name: "Aptos", bold: true, color: { argb: COLORS.text } };
    applyCellFormat(cell, "currency0");
  }
  for (let c = 1; c <= cols; c++) {
    const cell = sheet.getCell(totalsRow, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
    cell.border = { ...(cell.border ?? {}), ...BORDER_THICK_TOP, ...BORDER_THIN };
  }

  const endRow = totalsRow;
  for (let r = headerRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = { ...(cell.border ?? {}), ...BORDER_THIN };
      cell.font = { ...(cell.font ?? {}), name: "Aptos" };
    }
  }
  applyOuterBorder(sheet, headerRow, endRow, 1, cols);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  autoSizeColumns(sheet, 10, 28);
  autoAdjustRowHeights(sheet, startRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: cols, repeatRow: headerRow });
}

function rowBorderFill(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number): void {
  for (let c = startCol; c <= endCol; c++) {
    sheet.getCell(row, c).border = { ...BORDER_THIN };
  }
}

async function buildWorkbookInternal(scenarios: WorkbookScenario[], meta?: WorkbookBrandingMeta): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "theCREmodel";
  workbook.created = new Date();
  const usedSheetNames = new Set<string>();
  const safeMeta: WorkbookBrandingMeta = {
    brokerageName: normalizeText(meta?.brokerageName, "theCREmodel"),
    clientName: normalizeText(meta?.clientName, "Client"),
    reportDate: meta?.reportDate || toIsoDate(new Date()),
    preparedBy: normalizeText(meta?.preparedBy, "theCREmodel"),
    market: normalizeText(meta?.market, ""),
    brokerageLogoDataUrl: meta?.brokerageLogoDataUrl ?? null,
    clientLogoDataUrl: meta?.clientLogoDataUrl ?? null,
  };

  createCoverSheet(workbook, usedSheetNames, scenarios, safeMeta);
  createSummarySheet(workbook, usedSheetNames, scenarios, safeMeta);
  createEqualizedSheet(workbook, usedSheetNames, scenarios, safeMeta);
  createMonthlyGrossMatrixSheet(workbook, usedSheetNames, scenarios, safeMeta);
  scenarios.forEach((scenario) => createAppendixSheet(workbook, usedSheetNames, scenario, safeMeta));

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ExcelJS.Buffer;
}

export async function buildBrokerWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08,
  meta?: WorkbookBrandingMeta
): Promise<ExcelJS.Buffer> {
  const results = scenarios.map((scenario) => runMonthlyEngine(scenario, globalDiscountRate));
  const workbookScenarios = buildScenariosFromCanonical(scenarios, results);
  return buildWorkbookInternal(workbookScenarios, meta);
}

export async function buildBrokerWorkbookFromCanonicalResponses(
  items: { response: CanonicalComputeResponse; scenarioName: string }[],
  meta?: WorkbookBrandingMeta
): Promise<ExcelJS.Buffer> {
  const workbookScenarios = buildScenariosFromCanonicalResponses(items);
  return buildWorkbookInternal(workbookScenarios, meta);
}

export async function buildWorkbook(
  scenarios: LeaseScenarioCanonical[],
  globalDiscountRate: number = 0.08
): Promise<ExcelJS.Buffer> {
  return buildBrokerWorkbook(scenarios, globalDiscountRate);
}

export { buildWorkbookLegacy };
