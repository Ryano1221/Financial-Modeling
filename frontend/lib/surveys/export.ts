import ExcelJS from "exceljs";
import {
  EXCEL_THEME,
  EXPORT_BRAND,
  applyExcelPageSetup,
  buildExportMetaLine,
  buildPlatformExportFileName,
  resolveExportBranding,
} from "@/lib/export-design";
import { downloadArrayBuffer as downloadArrayBufferShared, escapeHtml, openPrintWindow } from "@/lib/export-runtime";
import {
  buildPlatformShareLink,
  parsePlatformShareData,
} from "@/lib/platform-share";
import { decodeSharePayload } from "@/lib/share-link";
import { computeSurveyMonthlyOccupancyCost } from "./engine";
import type { SurveyEntry, SurveysExportBranding, SurveysSharePayload } from "./types";

const COLORS = EXPORT_BRAND.excel.colors;
const NUM_FMT = EXPORT_BRAND.excel.numberFormats;

interface ResolvedSurveyBranding {
  brokerageName: string;
  clientName: string;
  reportDate: string;
  preparedBy: string;
  brokerageLogoDataUrl: string;
  clientLogoDataUrl: string;
}

interface SurveyKpi {
  label: string;
  value: string;
}

function toCurrency(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function toDateLabel(value: string): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "-";
  return `${match[2]}.${match[3]}.${match[1]}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asText(value: unknown, fallback = "-"): string {
  const text = String(value || "").trim();
  return text || fallback;
}

function resolveSurveyBranding(branding: SurveysExportBranding = {}): ResolvedSurveyBranding {
  const resolved = resolveExportBranding(branding);
  return {
    ...resolved,
    brokerageLogoDataUrl: String(branding.brokerageLogoDataUrl || "").trim(),
    clientLogoDataUrl: String(branding.clientLogoDataUrl || "").trim(),
  };
}

function dataUrlImageExtension(dataUrl: string | null | undefined): "png" | "jpeg" | null {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;]+);base64,/i);
  const mime = match?.[1]?.toLowerCase() || "";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  return null;
}

function styleHeaderBand(sheet: ExcelJS.Worksheet, title: string, subtitle: string, totalCols: number): number {
  sheet.mergeCells(1, 1, 2, totalCols);
  const band = sheet.getCell(1, 1);
  band.value = subtitle ? `${title}\n${subtitle}` : title;
  band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  band.font = {
    name: EXCEL_THEME.font.family,
    size: EXCEL_THEME.font.subtitleSize,
    bold: true,
    color: { argb: COLORS.white },
  };
  band.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 20;
  sheet.getRow(2).height = 20;
  return 3;
}

function styleMetaRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  totalCols: number,
  branding: ResolvedSurveyBranding,
): number {
  sheet.mergeCells(row, 1, row, totalCols);
  const cell = sheet.getCell(row, 1);
  cell.value = buildExportMetaLine(branding);
  cell.font = {
    name: EXCEL_THEME.font.family,
    size: EXCEL_THEME.font.labelSize,
    color: { argb: COLORS.secondaryText },
    bold: true,
  };
  cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(row).height = 18;

  for (let c = 1; c <= totalCols; c += 1) {
    const borderCell = sheet.getCell(row, c);
    borderCell.border = {
      ...(borderCell.border ?? {}),
      bottom: { style: "thin", color: { argb: COLORS.border } },
    };
  }
  return row + 2;
}

function addHeaderLogos(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  totalCols: number,
  branding: ResolvedSurveyBranding,
): void {
  const brokerageExt = dataUrlImageExtension(branding.brokerageLogoDataUrl);
  const clientExt = dataUrlImageExtension(branding.clientLogoDataUrl);

  if (brokerageExt) {
    const imageId = workbook.addImage({ base64: branding.brokerageLogoDataUrl, extension: brokerageExt });
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.15 },
      ext: { width: 112, height: 28 },
      editAs: "oneCell",
    });
  }
  if (clientExt) {
    const imageId = workbook.addImage({ base64: branding.clientLogoDataUrl, extension: clientExt });
    sheet.addImage(imageId, {
      tl: { col: Math.max(1.2, totalCols - 1.7), row: 0.15 },
      ext: { width: 102, height: 28 },
      editAs: "oneCell",
    });
  }
}

function addBrandedHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  totalCols: number,
  branding: ResolvedSurveyBranding,
): number {
  const rowAfterBand = styleHeaderBand(sheet, title, subtitle, totalCols);
  addHeaderLogos(workbook, sheet, totalCols, branding);
  return styleMetaRow(sheet, rowAfterBand, totalCols, branding);
}

function styleTableHeader(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number): void {
  sheet.getRow(row).height = EXCEL_THEME.rowHeights.tableHeader;
  for (let c = startCol; c <= endCol; c += 1) {
    const cell = sheet.getCell(row, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
    cell.font = {
      name: EXCEL_THEME.font.family,
      size: EXCEL_THEME.font.sectionSize,
      bold: true,
      color: { argb: COLORS.white },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  }
}

function styleTableBodyRow(sheet: ExcelJS.Worksheet, row: number, startCol: number, endCol: number, striped = false): void {
  sheet.getRow(row).height = EXCEL_THEME.rowHeights.body;
  for (let c = startCol; c <= endCol; c += 1) {
    const cell = sheet.getCell(row, c);
    cell.fill = striped
      ? { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mutedFill } }
      : { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    cell.font = {
      ...(cell.font ?? {}),
      name: EXCEL_THEME.font.family,
      size: EXCEL_THEME.font.bodySize,
      color: { argb: COLORS.text },
    };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  }
}

function sortedEntries(entries: SurveyEntry[]): SurveyEntry[] {
  return [...entries].sort((left, right) => {
    const monthlyDelta = computeSurveyMonthlyOccupancyCost(left).totalMonthly - computeSurveyMonthlyOccupancyCost(right).totalMonthly;
    if (monthlyDelta !== 0) return monthlyDelta;
    return asText(left.buildingName, "").localeCompare(asText(right.buildingName, ""));
  });
}

function buildSurveyKpis(entries: SurveyEntry[]): SurveyKpi[] {
  const ranked = sortedEntries(entries);
  const readyCount = entries.filter((entry) => !entry.needsReview).length;
  const directCount = entries.filter((entry) => entry.occupancyType === "Direct").length;
  const subleaseCount = entries.filter((entry) => entry.occupancyType === "Sublease").length;
  const best = ranked[0];
  return [
    { label: "Options Evaluated", value: String(entries.length) },
    { label: "Client-Ready Rows", value: String(readyCount) },
    { label: "Needs Review", value: String(entries.length - readyCount) },
    { label: "Average RSF", value: Math.round(average(entries.map((entry) => entry.availableSqft))).toLocaleString("en-US") || "0" },
    { label: "Average Base Rent", value: toCurrency(average(entries.map((entry) => entry.baseRentPsfAnnual)), 2) },
    {
      label: "Lowest Monthly Occupancy",
      value: best ? `${toCurrency(computeSurveyMonthlyOccupancyCost(best).totalMonthly)}${best.buildingName ? ` at ${best.buildingName}` : ""}` : "-",
    },
    { label: "Direct Options", value: String(directCount) },
    { label: "Sublease Options", value: String(subleaseCount) },
  ];
}

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  entries: SurveyEntry[],
  branding: ResolvedSurveyBranding,
): void {
  const sheet = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 8, showGridLines: false }] });
  sheet.columns = [
    { width: 30 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];
  const totalCols = 6;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Survey Financial Analysis",
    "Presentation summary for survey comparison, occupancy economics, and QA readiness",
    totalCols,
    branding,
  );

  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Portfolio Snapshot";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const kpis = buildSurveyKpis(entries);
  for (let idx = 0; idx < kpis.length; idx += 2) {
    const left = kpis[idx];
    const right = kpis[idx + 1];
    sheet.getCell(row, 1).value = left.label;
    sheet.getCell(row, 2).value = left.value;
    sheet.getCell(row, 3).value = right?.label || "";
    sheet.getCell(row, 4).value = right?.value || "";
    sheet.mergeCells(row, 4, row, 6);
    sheet.getCell(row, 2).font = { name: EXCEL_THEME.font.family, bold: true, size: 11, color: { argb: COLORS.text } };
    sheet.getCell(row, 4).font = { name: EXCEL_THEME.font.family, bold: true, size: 11, color: { argb: COLORS.text } };
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }

  row += 1;
  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Top Options By Monthly Occupancy";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const topHeaders = ["Rank", "Building", "Occupancy", "Lease Type", "RSF", "Monthly Occupancy"];
  topHeaders.forEach((header, idx) => {
    sheet.getCell(row, idx + 1).value = header;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const tableHeaderRow = row;
  row += 1;

  sortedEntries(entries).slice(0, 6).forEach((entry, index) => {
    const monthly = computeSurveyMonthlyOccupancyCost(entry).totalMonthly;
    sheet.getCell(row, 1).value = index + 1;
    sheet.getCell(row, 2).value = asText(entry.buildingName);
    sheet.getCell(row, 3).value = entry.occupancyType;
    sheet.getCell(row, 4).value = entry.leaseType;
    sheet.getCell(row, 5).value = entry.availableSqft;
    sheet.getCell(row, 6).value = monthly;
    sheet.getCell(row, 5).numFmt = NUM_FMT.integer;
    sheet.getCell(row, 6).numFmt = NUM_FMT.currency0;
    for (let c = 1; c <= totalCols; c += 1) {
      sheet.getCell(row, c).alignment = { horizontal: c >= 5 ? "right" : "left", vertical: "middle", wrapText: true };
    }
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: Math.max(row + 1, tableHeaderRow + 2),
    lastCol: totalCols,
    fitToHeight: 1,
  });
}

function writeComparisonSheet(
  workbook: ExcelJS.Workbook,
  entries: SurveyEntry[],
  branding: ResolvedSurveyBranding,
): void {
  const sheet = workbook.addWorksheet("Survey Comparison", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  sheet.columns = [
    { width: 24 },
    { width: 28 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
    { width: 20 },
    { width: 15 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 28 },
  ];
  const totalCols = 16;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Survey Comparison Matrix",
    "Ranked occupancy comparison with source context and review status",
    totalCols,
    branding,
  );

  const headers = [
    "Building",
    "Address",
    "Suite / Floor",
    "Occupancy",
    "Lease Type",
    "Sublessor",
    "Sublease Expiration",
    "RSF",
    "Base Rent",
    "OpEx",
    "Parking",
    "Parking Rate",
    "Monthly Occupancy",
    "Source",
    "Status",
    "Notes",
  ];
  headers.forEach((header, idx) => {
    sheet.getCell(row, idx + 1).value = header;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  sortedEntries(entries).forEach((entry) => {
    const monthly = computeSurveyMonthlyOccupancyCost(entry).totalMonthly;
    const values = [
      asText(entry.buildingName),
      asText(entry.address),
      [entry.suite, entry.floor].filter(Boolean).join(" / ") || "-",
      entry.occupancyType,
      entry.leaseType,
      asText(entry.sublessor),
      toDateLabel(entry.subleaseExpirationDate),
      entry.availableSqft,
      entry.baseRentPsfAnnual,
      entry.opexPsfAnnual,
      entry.parkingSpaces,
      entry.parkingRateMonthlyPerSpace,
      monthly,
      asText(entry.sourceDocumentName || entry.sourceType),
      entry.needsReview ? "Needs Review" : "Client Ready",
      asText(entry.notes, ""),
    ];
    values.forEach((value, idx) => {
      const cell = sheet.getCell(row, idx + 1);
      cell.value = value as string | number;
      cell.alignment = { horizontal: idx >= 7 && idx <= 12 ? "right" : "left", vertical: "middle", wrapText: true };
    });
    sheet.getCell(row, 8).numFmt = NUM_FMT.integer;
    sheet.getCell(row, 9).numFmt = NUM_FMT.currency2;
    sheet.getCell(row, 10).numFmt = NUM_FMT.currency2;
    sheet.getCell(row, 11).numFmt = NUM_FMT.integer;
    sheet.getCell(row, 12).numFmt = NUM_FMT.currency0;
    sheet.getCell(row, 13).numFmt = NUM_FMT.currency0;
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: Math.max(row, headerRow + 2),
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
  });
}

function writeEntryProfilesSheet(
  workbook: ExcelJS.Workbook,
  entries: SurveyEntry[],
  branding: ResolvedSurveyBranding,
): void {
  const sheet = workbook.addWorksheet("Entry Profiles", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 22 },
    { width: 20 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
    { width: 24 },
  ];
  const totalCols = 8;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Entry Profiles",
    "Property-level notes and source context for each survey row",
    totalCols,
    branding,
  );

  sortedEntries(entries).forEach((entry, index) => {
    const monthly = computeSurveyMonthlyOccupancyCost(entry).totalMonthly;
    sheet.mergeCells(row, 1, row, totalCols);
    const titleCell = sheet.getCell(row, 1);
    titleCell.value = `${index + 1}. ${asText(entry.buildingName)}${entry.needsReview ? "  |  Needs Review" : "  |  Client Ready"}`;
    styleTableHeader(sheet, row, 1, totalCols);
    row += 1;

    const detailRows: Array<Array<string | number>> = [
      ["Address", asText(entry.address), "Suite / Floor", [entry.suite, entry.floor].filter(Boolean).join(" / ") || "-"],
      ["Occupancy", entry.occupancyType, "Lease Type", entry.leaseType],
      ["RSF", entry.availableSqft, "Monthly Occupancy", monthly],
      ["Base Rent", entry.baseRentPsfAnnual, "OpEx", entry.opexPsfAnnual],
      ["Parking Spaces", entry.parkingSpaces, "Parking Rate", entry.parkingRateMonthlyPerSpace],
      ["Sublessor", asText(entry.sublessor), "Sublease Exp.", toDateLabel(entry.subleaseExpirationDate)],
      ["Source", asText(entry.sourceDocumentName || entry.sourceType), "Uploaded", toDateLabel(entry.uploadedAtIso.slice(0, 10))],
      ["Notes", asText(entry.notes, ""), "Review Reasons", entry.reviewReasons.join(" | ") || "None"],
    ];

    detailRows.forEach((detailRow) => {
      sheet.getCell(row, 1).value = detailRow[0];
      sheet.getCell(row, 2).value = detailRow[1];
      sheet.getCell(row, 4).value = detailRow[2];
      sheet.mergeCells(row, 4, row, 5);
      sheet.mergeCells(row, 6, row, 8);
      sheet.getCell(row, 6).value = detailRow[3];
      sheet.getCell(row, 2).alignment = { horizontal: typeof detailRow[1] === "number" ? "right" : "left", vertical: "middle", wrapText: true };
      sheet.getCell(row, 6).alignment = { horizontal: typeof detailRow[3] === "number" ? "right" : "left", vertical: "middle", wrapText: true };
      if (detailRow[0] === "RSF") sheet.getCell(row, 2).numFmt = NUM_FMT.integer;
      if (detailRow[0] === "Base Rent") sheet.getCell(row, 2).numFmt = NUM_FMT.currency2;
      if (detailRow[0] === "Parking Spaces") sheet.getCell(row, 2).numFmt = NUM_FMT.integer;
      if (detailRow[2] === "Monthly Occupancy") sheet.getCell(row, 6).numFmt = NUM_FMT.currency0;
      if (detailRow[2] === "OpEx") sheet.getCell(row, 6).numFmt = NUM_FMT.currency2;
      if (detailRow[2] === "Parking Rate") sheet.getCell(row, 6).numFmt = NUM_FMT.currency0;
      for (const col of [1, 2, 4, 6]) {
        const cell = sheet.getCell(row, col);
        if (col === 1 || col === 4) {
          cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.labelSize, bold: true, color: { argb: COLORS.secondaryText } };
        }
      }
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    });

    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: Math.max(row, 8),
    lastCol: totalCols,
  });
}

function writeReviewSheet(
  workbook: ExcelJS.Workbook,
  entries: SurveyEntry[],
  branding: ResolvedSurveyBranding,
): void {
  const sheet = workbook.addWorksheet("Review Queue", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  sheet.columns = [
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 42 },
  ];
  const totalCols = 5;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Review Queue",
    "Rows requiring analyst confirmation before client delivery",
    totalCols,
    branding,
  );

  const reviewRows = sortedEntries(entries).filter((entry) => entry.needsReview);
  if (reviewRows.length === 0) {
    sheet.mergeCells(row, 1, row + 1, totalCols);
    const cell = sheet.getCell(row, 1);
    cell.value = "All survey rows are marked client ready. No open review items remain.";
    cell.font = { name: EXCEL_THEME.font.family, size: 12, bold: true, color: { argb: COLORS.text } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mutedFill } };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
    applyExcelPageSetup(sheet, { landscape: false, lastRow: row + 2, lastCol: totalCols, fitToHeight: 1 });
    return;
  }

  const headers = ["Building", "Occupancy", "Lease Type", "Source", "Review Reasons"];
  headers.forEach((header, idx) => {
    sheet.getCell(row, idx + 1).value = header;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  reviewRows.forEach((entry) => {
    sheet.getCell(row, 1).value = asText(entry.buildingName);
    sheet.getCell(row, 2).value = entry.occupancyType;
    sheet.getCell(row, 3).value = entry.leaseType;
    sheet.getCell(row, 4).value = asText(entry.sourceDocumentName || entry.sourceType);
    sheet.getCell(row, 5).value = entry.reviewReasons.join(" | ");
    for (let c = 1; c <= totalCols; c += 1) {
      sheet.getCell(row, c).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    }
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: Math.max(row, headerRow + 2),
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
    fitToHeight: 1,
  });
}

function logoHtml(dataUrl: string, alt: string, align: "left" | "right"): string {
  const safe = String(dataUrl || "").trim();
  if (!safe) return "";
  return `<div class="logo ${align}"><img src="${safe}" alt="${escapeHtml(alt)}" /></div>`;
}

function buildSurveyPdfHtml(entries: SurveyEntry[], branding: ResolvedSurveyBranding): string {
  const ranked = sortedEntries(entries);
  const kpis = buildSurveyKpis(entries);
  const reviewEntries = ranked.filter((entry) => entry.needsReview);
  const comparisonRows = ranked
    .map((entry, index) => {
      const monthly = computeSurveyMonthlyOccupancyCost(entry).totalMonthly;
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(asText(entry.buildingName))}</td>
        <td>${escapeHtml(asText(entry.address))}</td>
        <td>${escapeHtml([entry.suite, entry.floor].filter(Boolean).join(" / ") || "-")}</td>
        <td>${escapeHtml(entry.occupancyType)}</td>
        <td>${escapeHtml(entry.leaseType)}</td>
        <td class="num">${escapeHtml(entry.availableSqft.toLocaleString("en-US"))}</td>
        <td class="num">${escapeHtml(toCurrency(entry.baseRentPsfAnnual, 2))}</td>
        <td class="num">${escapeHtml(toCurrency(entry.opexPsfAnnual, 2))}</td>
        <td class="num">${escapeHtml(toCurrency(monthly))}</td>
        <td>${escapeHtml(entry.needsReview ? "Needs Review" : "Client Ready")}</td>
      </tr>`;
    })
    .join("");

  const reviewCards = reviewEntries.length > 0
    ? reviewEntries
        .map((entry) => `<article class="review-card">
          <div class="review-head">
            <strong>${escapeHtml(asText(entry.buildingName))}</strong>
            <span>${escapeHtml(entry.occupancyType)} | ${escapeHtml(entry.leaseType)}</span>
          </div>
          <p>${escapeHtml(entry.reviewReasons.join(" | "))}</p>
        </article>`)
        .join("")
    : `<article class="review-card"><div class="review-head"><strong>Review Queue Clear</strong><span>Client ready</span></div><p>No survey rows are currently flagged for analyst follow-up.</p></article>`;

  const kpiCards = kpis
    .slice(0, 6)
    .map((kpi) => `<div class="kpi-card"><span>${escapeHtml(kpi.label)}</span><strong>${escapeHtml(kpi.value)}</strong></div>`)
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(buildSurveysExportFileName("pdf", branding).replace(/\.pdf$/i, ""))}</title>
      <style>
        @page { size: letter landscape; margin: 0.42in; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: ${EXPORT_BRAND.pdf.fonts.family};
          color: ${EXPORT_BRAND.pdf.colors.ink};
          background: white;
        }
        .page {
          page-break-after: always;
        }
        .page:last-child {
          page-break-after: auto;
        }
        .hero {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 38%, #ffffff 100%);
          padding: 24px;
        }
        .hero-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          min-height: 42px;
        }
        .logo img {
          max-height: 34px;
          max-width: 150px;
          object-fit: contain;
        }
        .hero h1 {
          margin: 18px 0 8px;
          font-size: 28px;
          line-height: 1.05;
        }
        .hero p {
          margin: 0;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
          font-size: 12px;
          line-height: 1.6;
        }
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }
        .kpi-card {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          background: rgba(255,255,255,0.88);
          padding: 12px 14px;
        }
        .kpi-card span {
          display: block;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
          margin-bottom: 6px;
        }
        .kpi-card strong {
          display: block;
          font-size: 17px;
          line-height: 1.2;
        }
        .section {
          margin-top: 16px;
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 16px;
        }
        .section h2 {
          margin: 0 0 10px;
          font-size: 14px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }
        th, td {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 6px 7px;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: ${EXPORT_BRAND.pdf.colors.panelFill};
          font-size: 9px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .num {
          text-align: right;
          white-space: nowrap;
        }
        .review-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .review-card {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          background: ${EXPORT_BRAND.pdf.colors.mutedFill};
          padding: 12px;
          break-inside: avoid;
        }
        .review-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
          font-size: 11px;
        }
        .review-card p {
          margin: 0;
          font-size: 11px;
          line-height: 1.55;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
        }
      </style>
    </head>
    <body>
      <section class="page">
        <div class="hero">
          <div class="hero-top">
            ${logoHtml(branding.brokerageLogoDataUrl, `${branding.brokerageName} logo`, "left")}
            ${logoHtml(branding.clientLogoDataUrl, `${branding.clientName} logo`, "right")}
          </div>
          <h1>Survey Financial Analysis</h1>
          <p>${escapeHtml(buildExportMetaLine(branding))}</p>
          <p>Client-facing survey presentation aligned to occupancy economics, source context, and analyst review status.</p>
          <div class="kpi-grid">${kpiCards}</div>
        </div>

        <div class="section">
          <h2>Comparison Matrix</h2>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Building</th>
                <th>Address</th>
                <th>Suite / Floor</th>
                <th>Occupancy</th>
                <th>Lease Type</th>
                <th>RSF</th>
                <th>Base Rent</th>
                <th>OpEx</th>
                <th>Monthly Occupancy</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${comparisonRows}</tbody>
          </table>
        </div>
      </section>

      <section class="page">
        <div class="section">
          <h2>Analyst Review Queue</h2>
          <div class="review-grid">${reviewCards}</div>
        </div>
      </section>
    </body>
  </html>`;
}

function toShareSafeEntry(entry: SurveyEntry): SurveyEntry {
  return {
    id: entry.id,
    clientId: entry.clientId,
    sourceDocumentName: entry.sourceDocumentName,
    sourceType: entry.sourceType,
    uploadedAtIso: entry.uploadedAtIso,
    buildingName: entry.buildingName,
    address: entry.address,
    floor: entry.floor,
    suite: entry.suite,
    availableSqft: entry.availableSqft,
    baseRentPsfAnnual: entry.baseRentPsfAnnual,
    opexPsfAnnual: entry.opexPsfAnnual,
    leaseType: entry.leaseType,
    occupancyType: entry.occupancyType,
    sublessor: entry.sublessor,
    subleaseExpirationDate: entry.subleaseExpirationDate,
    parkingSpaces: entry.parkingSpaces,
    parkingRateMonthlyPerSpace: entry.parkingRateMonthlyPerSpace,
    notes: entry.notes,
    needsReview: entry.needsReview,
    reviewReasons: entry.reviewReasons,
    extractionSummary: entry.extractionSummary,
    reviewTasks: [],
    fieldConfidence: {},
  };
}

export function buildSurveysExportFileName(kind: "xlsx" | "pdf", branding: SurveysExportBranding): string {
  return buildPlatformExportFileName({
    kind,
    brokerageName: branding.brokerageName,
    clientName: branding.clientName,
    reportDate: branding.reportDate,
    excelDescriptor: "Survey Financial Analysis",
    pdfDescriptor: "Survey Economic Presentation",
  });
}

export async function buildSurveysWorkbook(
  entries: SurveyEntry[],
  branding: SurveysExportBranding = {},
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "The CRE Model";
  workbook.created = new Date();
  workbook.modified = new Date();

  const resolvedBranding = resolveSurveyBranding(branding);
  writeSummarySheet(workbook, entries, resolvedBranding);
  writeComparisonSheet(workbook, entries, resolvedBranding);
  writeEntryProfilesSheet(workbook, entries, resolvedBranding);
  writeReviewSheet(workbook, entries, resolvedBranding);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function printSurveysPdf(entries: SurveyEntry[], branding: SurveysExportBranding = {}): void {
  const html = buildSurveyPdfHtml(entries, resolveSurveyBranding(branding));
  openPrintWindow(html, { width: 1440, height: 960 });
}

export function buildSurveysShareLink(entries: SurveyEntry[], branding: SurveysExportBranding = {}): string {
  return buildPlatformShareLink(
    "/surveys/share",
    "surveys",
    { entries: entries.map(toShareSafeEntry) },
    branding,
  );
}

export function parseSurveysShareData(encoded: string | null | undefined): SurveysSharePayload | null {
  const value = String(encoded || "").trim();
  if (!value) return null;
  const envelope = parsePlatformShareData<{ entries: SurveyEntry[] }>(value, "surveys");
  if (envelope && Array.isArray(envelope.payload.entries)) {
    return {
      version: 1,
      generatedAtIso: envelope.generatedAtIso,
      branding: {
        brokerageName: envelope.branding.brokerageName,
        clientName: envelope.branding.clientName,
        reportDate: envelope.branding.reportDate,
        preparedBy: envelope.branding.preparedBy,
      },
      entries: envelope.payload.entries,
    };
  }

  const parsed = decodeSharePayload<SurveysSharePayload>(value);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
  return parsed;
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  downloadArrayBufferShared(arrayBuffer, fileName, mimeType);
}
