import ExcelJS from "exceljs";
import type { LeaseScenarioCanonical } from "@/lib/lease-engine/canonical-schema";
import type { EngineResult } from "@/lib/lease-engine/monthly-engine";
import { runMonthlyEngine } from "@/lib/lease-engine/monthly-engine";
import { buildWorkbook as buildWorkbookLegacy } from "@/lib/lease-engine/excel-export";
import type { CanonicalComputeResponse } from "@/lib/types";
import { EXCEL_THEME } from "@/lib/excel-style-constants";
import { CRE_DEFAULT_LOGO_DATA_URL } from "@/lib/default-brokerage-logo-data-url";

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
  submarket?: string;
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
  black: EXCEL_THEME.colors.black,
  white: EXCEL_THEME.colors.white,
  lightGray: EXCEL_THEME.colors.mutedFill,
  darkGray: EXCEL_THEME.colors.sectionRule,
  text: EXCEL_THEME.colors.text,
  border: EXCEL_THEME.colors.border,
  secondaryText: EXCEL_THEME.colors.secondaryText,
};

const CURRENCY_0 = EXCEL_THEME.numberFormats.currency0;
const CURRENCY_2 = EXCEL_THEME.numberFormats.currency2;
const PERCENT_2 = EXCEL_THEME.numberFormats.percent2;
const COVER_WIDTH_COLS = EXCEL_THEME.spacing.coverCols;
const HEADER_HEIGHT_ROWS = EXCEL_THEME.spacing.headerRows;
const LOGO_BOX_W_PX = EXCEL_THEME.spacing.logoBoxWidthPx;
const LOGO_BOX_H_PX = EXCEL_THEME.spacing.logoBoxHeightPx;
const PADDING_PX = EXCEL_THEME.spacing.logoPaddingPx;
const DEFAULT_BROKERAGE_NAME = "The CRE Model";
const DEFAULT_PREPARED_BY = "The CRE Model";

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

const BORDER_RULE_TOP: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
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

function wrapTextByApproxChars(text: string, maxCharsPerLine: number): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];
  const words = clean.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function splitCellTextForContinuation(text: string, maxLinesPerRow: number, maxCharsPerLine: number): string[] {
  const lines = wrapTextByApproxChars(text, maxCharsPerLine);
  if (lines.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += maxLinesPerRow) {
    chunks.push(lines.slice(i, i + maxLinesPerRow).join("\n"));
  }
  return chunks;
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
      cell.alignment = { horizontal: "left", vertical: "middle" };
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
    style: "pageLayout",
    zoomScale: 100,
  } as ExcelJS.WorksheetView];
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: options.landscape ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
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

function resolveBrokerageLogoParsed(dataUrl?: string | null): ParsedImage | null {
  return parseImageDataUrl(dataUrl) || parseImageDataUrl(CRE_DEFAULT_LOGO_DATA_URL);
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
  box: { col: number; row: number; widthPx: number; heightPx: number; paddingPx?: number }
): boolean {
  if (!parsed) return false;
  const padding = Math.max(0, box.paddingPx ?? PADDING_PX);
  const innerWidth = Math.max(20, box.widthPx - padding * 2);
  const innerHeight = Math.max(20, box.heightPx - padding * 2);
  const ratio = parsed.width / Math.max(1, parsed.height);
  let targetWidth = innerWidth;
  let targetHeight = Math.floor(targetWidth / ratio);
  if (targetHeight > innerHeight) {
    targetHeight = innerHeight;
    targetWidth = Math.floor(targetHeight * ratio);
  }
  const imageId = workbook.addImage({ base64: parsed.dataUrl, extension: parsed.extension });
  sheet.addImage(imageId, {
    tl: { col: box.col - 1 + (padding / 64), row: box.row - 1 + (padding / 20) },
    ext: { width: Math.max(20, targetWidth), height: Math.max(20, targetHeight) },
  });
  return true;
}

function drawHorizontalSeparator(
  sheet: ExcelJS.Worksheet,
  row: number,
  startCol: number,
  endCol: number
): void {
  for (let c = startCol; c <= endCol; c++) {
    const cell = sheet.getCell(row, c);
    cell.border = {
      ...(cell.border ?? {}),
      bottom: { style: "thin", color: { argb: COLORS.border } },
    };
  }
}

function applyBrandHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  meta: WorkbookBrandingMeta,
  totalCols: number,
  sectionTitle: string,
  sectionSubtitle: string
): number {
  const reportDate = formatDateMmDdYyyy(meta.reportDate ?? toIsoDate(new Date()));
  const brokerageLogo = resolveBrokerageLogoParsed(meta.brokerageLogoDataUrl);
  const clientLogo = parseImageDataUrl(meta.clientLogoDataUrl);
  sheet.views = [{ showGridLines: false }];
  sheet.getRow(1).height = 22;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 26;
  sheet.getRow(4).height = 26;

  sheet.mergeCells(1, 1, 2, totalCols);
  const band = sheet.getCell(1, 1);
  band.value = `${sectionTitle}\n${sectionSubtitle}`;
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  band.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.subtitleSize, bold: true, color: { argb: COLORS.white } };
  band.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  const leftEndCol = Math.max(1, Math.floor(totalCols / 3));
  const rightStartCol = Math.max(leftEndCol + 1, totalCols - Math.floor(totalCols / 3) + 1);
  const centerStartCol = leftEndCol + 1;
  const centerEndCol = Math.max(centerStartCol, rightStartCol - 1);

  const brokeragePlaced = placeImageInBox(workbook, sheet, brokerageLogo, {
    col: 1,
    row: 3,
    widthPx: Math.max(120, leftEndCol * 64),
    heightPx: LOGO_BOX_H_PX + 18,
    paddingPx: PADDING_PX,
  });
  if (!brokeragePlaced) {
    sheet.mergeCells(3, 1, 4, leftEndCol);
    const fallback = sheet.getCell(3, 1);
    fallback.value = normalizeText(meta.brokerageName, DEFAULT_BROKERAGE_NAME);
    fallback.font = {
      name: EXCEL_THEME.font.family,
      size: EXCEL_THEME.font.sectionSize,
      bold: true,
      color: { argb: COLORS.text },
    };
    fallback.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  if (rightStartCol <= totalCols) {
    placeImageInBox(workbook, sheet, clientLogo, {
      col: rightStartCol,
      row: 3,
      widthPx: Math.max(120, (totalCols - rightStartCol + 1) * 64),
      heightPx: LOGO_BOX_H_PX + 18,
      paddingPx: PADDING_PX,
    });
  }

  if (centerStartCol <= centerEndCol) {
    sheet.mergeCells(3, centerStartCol, 4, centerEndCol);
    const centerCell = sheet.getCell(3, centerStartCol);
    centerCell.value = `REPORT DATE\n${reportDate}`;
    centerCell.font = {
      name: EXCEL_THEME.font.family,
      size: EXCEL_THEME.font.labelSize,
      bold: true,
      color: { argb: COLORS.secondaryText },
    };
    centerCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    const dateValueCell = sheet.getCell(4, centerStartCol);
    dateValueCell.font = {
      name: EXCEL_THEME.font.family,
      size: EXCEL_THEME.font.bodySize,
      bold: true,
      color: { argb: COLORS.text },
    };
  }
  drawHorizontalSeparator(sheet, 4, 1, totalCols);

  return HEADER_HEIGHT_ROWS + 2;
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
  sheet.columns = Array.from({ length: COVER_WIDTH_COLS }, () => ({ width: 15 }));
  sheet.views = [{ showGridLines: false }];
  sheet.properties.defaultRowHeight = 26;

  for (let c = 1; c <= COVER_WIDTH_COLS; c++) sheet.getColumn(c).width = c <= 7 ? 14 : 15;

  sheet.mergeCells(1, 1, 4, COVER_WIDTH_COLS);
  const titleBand = sheet.getCell(1, 1);
  titleBand.value = "THE COMMERCIAL REAL ESTATE MODEL\nLease Financial Analysis";
  titleBand.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  titleBand.font = {
    name: EXCEL_THEME.font.family,
    bold: true,
    size: EXCEL_THEME.font.titleSize,
    color: { argb: COLORS.white },
  };
  titleBand.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  for (let r = 1; r <= 4; r++) sheet.getRow(r).height = 32;
  sheet.getRow(5).height = 10;

  const reportDate = formatDateMmDdYyyy(meta.reportDate ?? toIsoDate(new Date()));
  const client = normalizeText(meta.clientName, "Client");
  const preparedBy = normalizeText(meta.preparedBy, DEFAULT_PREPARED_BY);
  const market = normalizeText(meta.market, "");
  const submarket = normalizeText(meta.submarket, "");

  const brokerageLogo = resolveBrokerageLogoParsed(meta.brokerageLogoDataUrl);
  const clientLogo = parseImageDataUrl(meta.clientLogoDataUrl);

  sheet.mergeCells(6, 1, 10, 7);
  const brokerageBox = sheet.getCell(6, 1);
  brokerageBox.value = "";
  brokerageBox.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
  brokerageBox.border = {
    top: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };

  const brokeragePlaced = placeImageInBox(workbook, sheet, brokerageLogo, {
    col: 1,
    row: 6,
    widthPx: 430,
    heightPx: 120,
    paddingPx: PADDING_PX,
  });
  if (!brokeragePlaced) {
    const fallback = sheet.getCell(6, 1);
    fallback.value = normalizeText(meta.brokerageName, DEFAULT_BROKERAGE_NAME);
    fallback.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.sectionSize, color: { argb: COLORS.text } };
    fallback.alignment = { horizontal: "left", vertical: "middle" };
  }

  sheet.mergeCells(11, 1, 15, 7);
  const clientBox = sheet.getCell(11, 1);
  clientBox.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
  clientBox.border = {
    top: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };
  if (clientLogo) {
    placeImageInBox(workbook, sheet, clientLogo, {
      col: 1,
      row: 11,
      widthPx: 430,
      heightPx: 120,
      paddingPx: PADDING_PX,
    });
  } else {
    clientBox.value = `PREPARED FOR\n${client}`;
    clientBox.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.sectionSize, bold: true, color: { argb: COLORS.text } };
    clientBox.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }

  for (let r = 6; r <= 15; r++) {
    for (let c = 8; c <= COVER_WIDTH_COLS; c++) {
      const cell = sheet.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
      const border: Partial<ExcelJS.Borders> = {};
      if (r === 6) border.top = { style: "thin", color: { argb: COLORS.border } };
      if (r === 15) border.bottom = { style: "thin", color: { argb: COLORS.border } };
      if (c === 8) border.left = { style: "thin", color: { argb: COLORS.border } };
      if (c === COVER_WIDTH_COLS) border.right = { style: "thin", color: { argb: COLORS.border } };
      cell.border = { ...(cell.border ?? {}), ...border };
    }
  }

  const detailRows: Array<{ label: string; value: string }> = [
    { label: "Prepared For", value: clientLogo ? "" : client },
    { label: "Prepared By", value: preparedBy },
    { label: "Report Date", value: reportDate },
    ...(market ? [{ label: "Market", value: market }] : []),
    ...(submarket ? [{ label: "Submarket", value: submarket }] : []),
    { label: "Scenario Count", value: String(scenarios.length) },
  ].filter((row) => row.value.trim().length > 0);

  let metaRow = 6;
  for (const detail of detailRows) {
    if (metaRow > 14) break;
    sheet.mergeCells(metaRow, 8, metaRow, COVER_WIDTH_COLS);
    const labelCell = sheet.getCell(metaRow, 8);
    labelCell.value = detail.label.toUpperCase();
    labelCell.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.labelSize, color: { argb: COLORS.secondaryText } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };

    sheet.mergeCells(metaRow + 1, 8, metaRow + 1, COVER_WIDTH_COLS);
    const valueCell = sheet.getCell(metaRow + 1, 8);
    valueCell.value = detail.value;
    valueCell.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
    valueCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    drawHorizontalSeparator(sheet, metaRow + 1, 8, COVER_WIDTH_COLS);
    metaRow += 2;
  }

  const scenarioBandRow = 17;
  sheet.mergeCells(scenarioBandRow, 1, scenarioBandRow, COVER_WIDTH_COLS);
  const scenarioBand = sheet.getCell(scenarioBandRow, 1);
  scenarioBand.value = "SCENARIO SNAPSHOT";
  scenarioBand.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  scenarioBand.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.sectionSize, color: { argb: COLORS.white } };
  scenarioBand.alignment = { horizontal: "left", vertical: "middle" };

  const headerRow = 18;
  sheet.getCell(headerRow, 1).value = "Scenario";
  sheet.getCell(headerRow, 9).value = "NPV Cost";
  sheet.getCell(headerRow, 11).value = "Total Obligation";
  sheet.mergeCells(headerRow, 1, headerRow, 8);
  sheet.mergeCells(headerRow, 9, headerRow, 10);
  sheet.mergeCells(headerRow, 11, headerRow, 12);
  for (const col of [1, 9, 11]) {
    const cell = sheet.getCell(headerRow, col);
    cell.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.labelSize, color: { argb: COLORS.secondaryText } };
    cell.alignment = col === 1 ? { horizontal: "left", vertical: "middle" } : { horizontal: "right", vertical: "middle" };
  }
  drawHorizontalSeparator(sheet, headerRow, 1, COVER_WIDTH_COLS);

  const ranked = [...scenarios].sort((a, b) => a.npvCost - b.npvCost).slice(0, 8);
  const minRows = 6;
  const rowsToRender = Math.max(minRows, ranked.length);
  let row = 19;
  for (let i = 0; i < rowsToRender; i++) {
    const scenario = ranked[i];
    const fill = i % 2 === 0 ? COLORS.white : COLORS.lightGray;
    sheet.mergeCells(row, 1, row, 8);
    sheet.mergeCells(row, 9, row, 10);
    sheet.mergeCells(row, 11, row, 12);

    const nameCell = sheet.getCell(row, 1);
    nameCell.value = scenario?.name ?? "—";
    nameCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, bold: !!scenario, color: { argb: COLORS.text } };
    nameCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    nameCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };

    const npvCell = sheet.getCell(row, 9);
    npvCell.value = scenario ? Number(scenario.npvCost.toFixed(4)) : "";
    npvCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (scenario) applyCellFormat(npvCell, "currency0");
    else npvCell.alignment = { horizontal: "right", vertical: "middle" };

    const totalCell = sheet.getCell(row, 11);
    totalCell.value = scenario ? Number(scenario.totalObligation.toFixed(4)) : "";
    totalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (scenario) applyCellFormat(totalCell, "currency0");
    else totalCell.alignment = { horizontal: "right", vertical: "middle" };

    for (let c = 1; c <= COVER_WIDTH_COLS; c++) {
      const cell = sheet.getCell(row, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.border = { ...(cell.border ?? {}), bottom: { style: "thin", color: { argb: COLORS.border } } };
    }
    row += 1;
  }

  const coverEndRow = row;
  drawHorizontalSeparator(sheet, 5, 1, COVER_WIDTH_COLS);
  for (let rowIdx = 6; rowIdx <= coverEndRow; rowIdx++) {
    sheet.getRow(rowIdx).height = rowIdx >= 19 ? 24 : EXCEL_THEME.rowHeights.coverMeta;
  }
  autoAdjustRowHeights(sheet, 1, coverEndRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: coverEndRow, lastCol: COVER_WIDTH_COLS });
}

function createSummarySheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Summary Comparison", "Summary Comparison", usedSheetNames));
  const metricCol = 1;
  const spacerCol = 2;
  const scenarioStartCol = 3;
  const tableLastCol = scenarioStartCol + scenarios.length - 1;
  const layoutLastCol = Math.max(14, tableLastCol);

  sheet.getColumn(metricCol).width = 28;
  sheet.getColumn(spacerCol).width = 2;
  for (let i = 0; i < scenarios.length; i++) {
    sheet.getColumn(scenarioStartCol + i).width = 24;
  }
  for (let c = tableLastCol + 1; c <= layoutLastCol; c++) {
    sheet.getColumn(c).width = 6;
  }

  const startRow = applyBrandHeader(
    workbook,
    sheet,
    meta,
    layoutLastCol,
    "SUMMARY COMPARISON",
    "Institutional scenario matrix"
  );
  const headerRow = 6;

  sheet.getRow(headerRow).height = EXCEL_THEME.rowHeights.tableHeader + 6;
  sheet.getCell(headerRow, metricCol).value = "Metric";
  sheet.getCell(headerRow, metricCol).font = {
    name: EXCEL_THEME.font.family,
    bold: true,
    size: EXCEL_THEME.font.sectionSize,
    color: { argb: COLORS.text },
  };
  sheet.getCell(headerRow, metricCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
  sheet.getCell(headerRow, metricCol).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getCell(headerRow, spacerCol).value = "";
  sheet.getCell(headerRow, spacerCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(headerRow, scenarioStartCol + idx);
    cell.value = scenario.name;
    cell.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.sectionSize, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  });
  for (let c = tableLastCol + 1; c <= layoutLastCol; c++) {
    const cell = sheet.getCell(headerRow, c);
    cell.value = "";
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  }

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
    { type: "metric", label: "Notes", format: "text", getter: () => "See Notes sheet" },
  ];

  let row = headerRow + 1;
  for (const def of rows) {
    if (def.type === "section") {
      sheet.mergeCells(row, metricCol, row, layoutLastCol);
      const cell = sheet.getCell(row, metricCol);
      cell.value = def.label;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
      cell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.secondaryText }, size: EXCEL_THEME.font.labelSize };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      for (let c = metricCol; c <= layoutLastCol; c++) {
        const sectionCell = sheet.getCell(row, c);
        sectionCell.border = {
          ...(sectionCell.border ?? {}),
          top: { style: "thin", color: { argb: COLORS.darkGray } },
        };
      }
      sheet.getRow(row).height = EXCEL_THEME.rowHeights.body;
      row += 1;
      continue;
    }

    const labelCell = sheet.getCell(row, metricCol);
    labelCell.value = def.label;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };
    labelCell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.text }, size: EXCEL_THEME.font.bodySize };
    labelCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    sheet.getCell(row, spacerCol).value = "";
    sheet.getCell(row, spacerCol).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
    scenarios.forEach((scenario, idx) => {
      const value = def.getter(scenario);
      const cell = sheet.getCell(row, scenarioStartCol + idx);
      cell.value = typeof value === "number" ? Number(value.toFixed(6)) : value;
      cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
      applyCellFormat(cell, def.format);
      if (def.format === "text" || def.format === "date") {
        cell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      }
    });
    for (let c = metricCol; c <= layoutLastCol; c++) {
      const cell = sheet.getCell(row, c);
      cell.border = {
        ...(cell.border ?? {}),
        bottom: { style: "thin", color: { argb: COLORS.border } },
      };
    }
    for (let c = tableLastCol + 1; c <= layoutLastCol; c++) {
      const cell = sheet.getCell(row, c);
      cell.value = "";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
    }
    sheet.getRow(row).height = EXCEL_THEME.rowHeights.body;
    row += 1;
  }
  const endRow = row - 1;
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: headerRow, showGridLines: false }];
  autoAdjustRowHeights(sheet, headerRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: layoutLastCol, repeatRow: headerRow });
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
  sheet.getRow(headerRow).height = EXCEL_THEME.rowHeights.tableHeader;
  sheet.getCell(headerRow, 1).value = "Metric";
  sheet.getCell(headerRow, 1).font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
  sheet.getCell(headerRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  sheet.getCell(headerRow, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(headerRow, idx + 2);
    cell.value = scenario.name;
    cell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
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
    label.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.text } };
    label.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    label.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    scenarios.forEach((scenario, cIdx) => {
      const cell = sheet.getCell(row, cIdx + 2);
      const value = metric.getter(scenario);
      cell.value = typeof value === "number" ? Number(value.toFixed(6)) : value;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (typeof value === "number") applyCellFormat(cell, metric.format);
      else cell.alignment = { horizontal: "left", vertical: "middle" };
    });
    for (let c = 1; c <= cols; c++) {
      const rowCell = sheet.getCell(row, c);
      rowCell.border = {
        ...(rowCell.border ?? {}),
        bottom: { style: "thin", color: { argb: COLORS.border } },
      };
    }
    row += 1;
  });

  const endRow = row - 1;
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
  sheet.getRow(headerRow).height = EXCEL_THEME.rowHeights.tableHeader;
  sheet.getCell(headerRow, 1).value = "Month #";
  sheet.getCell(headerRow, 2).value = "Date";
  for (let c = 1; c <= 2; c++) {
    const cell = sheet.getCell(headerRow, c);
    cell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  }
  scenarios.forEach((scenario, idx) => {
    const cell = sheet.getCell(headerRow, idx + 3);
    cell.value = scenario.name;
    cell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
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
    sheet.getCell(row, 1).alignment = { horizontal: "right", vertical: "middle" };
    sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle" };

    scenarios.forEach((scenario, idx) => {
      const start = parseIsoDate(scenario.commencementDate);
      const end = parseIsoDate(scenario.expirationDate);
      const active = start && end ? (date.getTime() >= addMonths(start, 0).getTime() && date.getTime() <= addMonths(end, 0).getTime()) : false;
      const value = active ? monthlyMaps[idx].get(key) : undefined;
      const cell = sheet.getCell(row, idx + 3);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (value == null || Number.isNaN(value)) {
        cell.value = "—";
        cell.alignment = { horizontal: "left", vertical: "middle" };
      } else {
        cell.value = Number(value.toFixed(4));
        applyCellFormat(cell, "currency0");
      }
    });
    for (let c = 1; c <= cols; c++) {
      const rowCell = sheet.getCell(row, c);
      rowCell.border = {
        ...(rowCell.border ?? {}),
        bottom: { style: "thin", color: { argb: COLORS.border } },
      };
    }
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
    cell.border = {
      ...(cell.border ?? {}),
      ...BORDER_RULE_TOP,
      bottom: { style: "thin", color: { argb: COLORS.border } },
    };
  }

  const endRow = totalRow;
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
  sheet.getRow(headerRow).height = EXCEL_THEME.rowHeights.tableHeader;
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
    cell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
    cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
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
      cell.border = {
        ...(cell.border ?? {}),
        bottom: { style: "thin", color: { argb: COLORS.border } },
      };
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
    cell.border = {
      ...(cell.border ?? {}),
      ...BORDER_RULE_TOP,
      bottom: { style: "thin", color: { argb: COLORS.border } },
    };
  }

  const endRow = totalsRow;
  const appendixLandscape = widths.reduce((sum, w) => sum + w, 0) > 95;
  for (let r = headerRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = sheet.getCell(r, c);
      cell.font = { ...(cell.font ?? {}), name: EXCEL_THEME.font.family };
    }
  }
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  autoSizeColumns(sheet, 10, 28);
  autoAdjustRowHeights(sheet, startRow, endRow);
  applyPrintSettings(sheet, { landscape: appendixLandscape, lastRow: endRow, lastCol: cols, repeatRow: headerRow });
}

function rowBorderFill(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number): void {
  for (let c = startCol; c <= endCol; c++) {
    sheet.getCell(row, c).border = { ...BORDER_THIN };
  }
}

function createNotesSheet(
  workbook: ExcelJS.Workbook,
  usedSheetNames: Set<string>,
  scenarios: WorkbookScenario[],
  meta: WorkbookBrandingMeta
): void {
  const sheet = workbook.addWorksheet(makeUniqueSheetName("Notes", "Notes", usedSheetNames));
  const totalCols = 14;
  const scenarioCol = 1;
  const notesCol = 2;

  sheet.getColumn(scenarioCol).width = 36;
  sheet.getColumn(notesCol).width = 96;
  for (let c = 3; c <= totalCols; c++) {
    sheet.getColumn(c).width = 4;
  }

  const startRow = applyBrandHeader(workbook, sheet, meta, totalCols, "NOTES", "Scenario notes and clause highlights");
  void startRow;
  const headerRow = 6;
  sheet.getRow(headerRow).height = EXCEL_THEME.rowHeights.tableHeader;

  const scenarioHeader = sheet.getCell(headerRow, scenarioCol);
  scenarioHeader.value = "Scenario";
  scenarioHeader.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
  scenarioHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  scenarioHeader.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  const notesHeader = sheet.getCell(headerRow, notesCol);
  notesHeader.value = "Notes";
  notesHeader.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white } };
  notesHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  notesHeader.alignment = { horizontal: "left", vertical: "middle", wrapText: true };

  for (let c = 3; c <= totalCols; c++) {
    const filler = sheet.getCell(headerRow, c);
    filler.value = "";
    filler.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
    filler.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  }

  let row = headerRow + 1;
  for (const scenario of scenarios) {
    const scenarioCell = sheet.getCell(row, scenarioCol);
    scenarioCell.value = scenario.name;
    scenarioCell.font = { name: EXCEL_THEME.font.family, bold: true, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
    scenarioCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    scenarioCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lightGray } };

    const notesCell = sheet.getCell(row, notesCol);
    notesCell.value = normalizeText(scenario.notes, "No notable clauses captured from extraction.");
    notesCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
    notesCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    notesCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };

    for (let c = 1; c <= totalCols; c++) {
      const cell = sheet.getCell(row, c);
      cell.border = { ...(cell.border ?? {}), bottom: { style: "thin", color: { argb: COLORS.border } } };
      if (c >= 3) {
        cell.value = "";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } };
      }
    }

    row += 1;
  }

  const endRow = row - 1;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  autoAdjustRowHeights(sheet, startRow, endRow);
  applyPrintSettings(sheet, { landscape: true, lastRow: endRow, lastCol: totalCols, repeatRow: headerRow });
}

async function buildWorkbookInternal(scenarios: WorkbookScenario[], meta?: WorkbookBrandingMeta): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "The CRE Model";
  workbook.created = new Date();
  const usedSheetNames = new Set<string>();
  const safeMeta: WorkbookBrandingMeta = {
    brokerageName: normalizeText(meta?.brokerageName, DEFAULT_BROKERAGE_NAME),
    clientName: normalizeText(meta?.clientName, "Client"),
    reportDate: meta?.reportDate || toIsoDate(new Date()),
    preparedBy: normalizeText(meta?.preparedBy, DEFAULT_PREPARED_BY),
    market: normalizeText(meta?.market, ""),
    submarket: normalizeText(meta?.submarket, ""),
    brokerageLogoDataUrl: meta?.brokerageLogoDataUrl ?? null,
    clientLogoDataUrl: meta?.clientLogoDataUrl ?? null,
  };

  createCoverSheet(workbook, usedSheetNames, scenarios, safeMeta);
  createSummarySheet(workbook, usedSheetNames, scenarios, safeMeta);
  createNotesSheet(workbook, usedSheetNames, scenarios, safeMeta);
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
