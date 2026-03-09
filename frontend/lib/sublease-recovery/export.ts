import ExcelJS from "exceljs";
import {
  EXCEL_THEME,
  EXPORT_BRAND,
  applyExcelPageSetup,
  buildPlatformExportFileName,
  formatDateMmDdYyyy,
} from "@/lib/export-design";
import type { ExistingObligation, SensitivityResult, SubleaseScenarioResult } from "./types";

export interface SubleaseRecoveryExportBranding {
  brokerageName?: string | null;
  clientName?: string | null;
  reportDate?: string | null;
  preparedBy?: string | null;
  brokerageLogoDataUrl?: string | null;
  clientLogoDataUrl?: string | null;
}

interface ScenarioDisplaySummary {
  scenario: SubleaseScenarioResult["scenario"];
  summary: SubleaseScenarioResult["summary"];
  monthlyCount: number;
}

const SHEET_MAX = 31;
const COLORS = EXPORT_BRAND.excel.colors;
const NUM_FMT = EXPORT_BRAND.excel.numberFormats;

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function toDateLabel(iso: string): string {
  const raw = String(iso || "").trim();
  if (!raw) return "-";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeSheetName(input: string, fallback: string): string {
  const normalized = String(input || "")
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = normalized || fallback;
  return name.slice(0, SHEET_MAX);
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
  branding: SubleaseRecoveryExportBranding,
): number {
  const reportDate = branding.reportDate || formatDateMmDdYyyy(new Date());
  const brokerage = String(branding.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name;
  const client = String(branding.clientName || "Client").trim() || "Client";
  const preparedBy = String(branding.preparedBy || "").trim();
  const preparedByText = preparedBy ? ` | Prepared by ${preparedBy}` : "";

  sheet.mergeCells(row, 1, row, totalCols);
  const cell = sheet.getCell(row, 1);
  cell.value = `${brokerage} | ${client} | Report Date ${reportDate}${preparedByText}`;
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

function dataUrlImageExtension(dataUrl: string | null | undefined): "png" | "jpeg" | null {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  const match = raw.match(/^data:([^;]+);base64,/i);
  const mime = match?.[1]?.toLowerCase() || "";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpeg";
  return null;
}

function addHeaderLogos(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  totalCols: number,
  branding: SubleaseRecoveryExportBranding,
): void {
  const brokerageLogo = String(branding.brokerageLogoDataUrl || "").trim();
  const clientLogo = String(branding.clientLogoDataUrl || "").trim();
  const brokerageExt = dataUrlImageExtension(brokerageLogo);
  const clientExt = dataUrlImageExtension(clientLogo);

  if (brokerageExt) {
    const imageId = workbook.addImage({ base64: brokerageLogo, extension: brokerageExt });
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.15 },
      ext: { width: 112, height: 28 },
      editAs: "oneCell",
    });
  }
  if (clientExt) {
    const imageId = workbook.addImage({ base64: clientLogo, extension: clientExt });
    sheet.addImage(imageId, {
      tl: { col: Math.max(1.2, totalCols - 1.7), row: 0.15 },
      ext: { width: 102, height: 28 },
      editAs: "oneCell",
    });
  }
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

function addBrandedHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  totalCols: number,
  branding: SubleaseRecoveryExportBranding,
): number {
  const rowAfterBand = styleHeaderBand(sheet, title, subtitle, totalCols);
  addHeaderLogos(workbook, sheet, totalCols, branding);
  return styleMetaRow(sheet, rowAfterBand, totalCols, branding);
}

function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  branding: SubleaseRecoveryExportBranding,
): void {
  const sheet = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 8, showGridLines: false }] });
  sheet.columns = [
    { width: 36 },
    { width: 24 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
  ];
  const totalCols = 6;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    "Decision summary with baseline obligation and scenario outcomes",
    totalCols,
    branding,
  );

  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Existing Obligation";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const existingRows: Array<[string, string | number]> = [
    ["Premises", existing.premises],
    ["Rentable Square Footage", existing.rsf],
    ["Lease Commencement", toDateLabel(existing.commencementDate)],
    ["Lease Expiration", toDateLabel(existing.expirationDate)],
    ["Lease Type", String(existing.leaseType).toUpperCase()],
  ];
  for (const [label, value] of existingRows) {
    sheet.getCell(row, 1).value = label;
    sheet.mergeCells(row, 2, row, totalCols);
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = value;
    valueCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (typeof value === "number") {
      valueCell.numFmt = NUM_FMT.integer;
    }
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }
  row += 1;

  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Scenario KPI Snapshot";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const kpiHeaders = ["Scenario", "Subtenant", "Net Obligation", "Net Sublease Recovery", "Recovery %", "NPV @ Discount"];
  for (let c = 1; c <= kpiHeaders.length; c += 1) {
    sheet.getCell(row, c).value = kpiHeaders[c - 1];
  }
  styleTableHeader(sheet, row, 1, kpiHeaders.length);
  const kpiHeaderRow = row;
  row += 1;

  for (const result of results) {
    sheet.getCell(row, 1).value = result.summary.scenarioName;
    sheet.getCell(row, 2).value = result.scenario.subtenantName || "—";
    sheet.getCell(row, 3).value = result.summary.netObligation;
    sheet.getCell(row, 4).value = result.summary.netSubleaseRecovery;
    sheet.getCell(row, 5).value = result.summary.recoveryPercent;
    sheet.getCell(row, 6).value = result.summary.npv;

    sheet.getCell(row, 3).numFmt = NUM_FMT.currency0;
    sheet.getCell(row, 4).numFmt = NUM_FMT.currency0;
    sheet.getCell(row, 5).numFmt = NUM_FMT.percent2;
    sheet.getCell(row, 6).numFmt = NUM_FMT.currency0;

    sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    for (let c = 3; c <= 6; c += 1) {
      sheet.getCell(row, c).alignment = { horizontal: "right", vertical: "middle" };
    }
    styleTableBodyRow(sheet, row, 1, 6, row % 2 === 0);
    row += 1;
  }

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: Math.max(row + 1, kpiHeaderRow + 2),
    lastCol: totalCols,
    fitToHeight: 1,
  });
}

function buildComparisonRows(
  existing: ExistingObligation,
  resultRows: ScenarioDisplaySummary[],
): Array<{ label: string; format: "text" | "integer" | "currency0" | "percent"; values: Array<number | string> }> {
  const baseline = resultRows[0]?.summary.totalRemainingObligation ?? 0;
  return [
    {
      label: "Premises",
      format: "text",
      values: [existing.premises, ...resultRows.map((item) => item.scenario.name)],
    },
    {
      label: "Subtenant",
      format: "text",
      values: ["—", ...resultRows.map((item) => item.scenario.subtenantName || "—")],
    },
    {
      label: "Scenario Source",
      format: "text",
      values: [
        "Existing Obligation",
        ...resultRows.map((item) =>
          item.scenario.sourceType === "proposal_import"
            ? `Imported: ${item.scenario.sourceDocumentName || "Proposal"}`
            : "Manual",
        ),
      ],
    },
    {
      label: "Rentable Square Footage",
      format: "integer",
      values: [existing.rsf, ...resultRows.map((item) => item.scenario.rsf)],
    },
    {
      label: "Sublease Commencement",
      format: "text",
      values: [toDateLabel(existing.commencementDate), ...resultRows.map((item) => toDateLabel(item.scenario.subleaseCommencementDate))],
    },
    {
      label: "Sublease Expiration",
      format: "text",
      values: [toDateLabel(existing.expirationDate), ...resultRows.map((item) => toDateLabel(item.scenario.subleaseExpirationDate))],
    },
    {
      label: "Total Remaining Obligation",
      format: "currency0",
      values: [baseline, ...resultRows.map((item) => item.summary.totalRemainingObligation)],
    },
    {
      label: "Total Sublease Recovery",
      format: "currency0",
      values: [0, ...resultRows.map((item) => item.summary.totalSubleaseRecovery)],
    },
    {
      label: "Total Sublease Costs",
      format: "currency0",
      values: [0, ...resultRows.map((item) => item.summary.totalSubleaseCosts)],
    },
    {
      label: "Net Sublease Recovery",
      format: "currency0",
      values: [0, ...resultRows.map((item) => item.summary.netSubleaseRecovery)],
    },
    {
      label: "Net Obligation",
      format: "currency0",
      values: [baseline, ...resultRows.map((item) => item.summary.netObligation)],
    },
    {
      label: "Recovery %",
      format: "percent",
      values: [0, ...resultRows.map((item) => item.summary.recoveryPercent)],
    },
    {
      label: "Recovery % per SF",
      format: "percent",
      values: [0, ...resultRows.map((item) => item.summary.recoveryPercentPerSf)],
    },
    {
      label: "Average Total Cost per SF per Year",
      format: "currency0",
      values: [baseline / Math.max(existing.rsf, 1), ...resultRows.map((item) => item.summary.averageTotalCostPerSfPerYear)],
    },
    {
      label: "Average Total Cost per Month",
      format: "currency0",
      values: [baseline / Math.max(1, resultRows[0]?.monthlyCount || 1), ...resultRows.map((item) => item.summary.averageTotalCostPerMonth)],
    },
    {
      label: "Average Total Cost per Year",
      format: "currency0",
      values: [baseline / Math.max(1 / 12, (resultRows[0]?.monthlyCount || 1) / 12), ...resultRows.map((item) => item.summary.averageTotalCostPerYear)],
    },
    {
      label: "NPV @ Discount Rate",
      format: "currency0",
      values: [resultRows[0]?.summary.npv ?? 0, ...resultRows.map((item) => item.summary.npv)],
    },
  ];
}

function writeScenarioComparisonSheet(
  workbook: ExcelJS.Workbook,
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  branding: SubleaseRecoveryExportBranding,
): void {
  const resultRows = results.map((result) => ({ scenario: result.scenario, summary: result.summary, monthlyCount: result.monthly.length }));
  const sheet = workbook.addWorksheet("Scenario Comparison", { views: [{ state: "frozen", xSplit: 1, ySplit: 7, showGridLines: false }] });
  const totalCols = 2 + results.length;
  sheet.columns = [{ width: 34 }, ...Array.from({ length: totalCols - 1 }, () => ({ width: 21 }))];

  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    "Scenario comparison grid",
    totalCols,
    branding,
  );

  sheet.getCell(row, 1).value = "Metric";
  sheet.getCell(row, 2).value = "Existing Obligation";
  results.forEach((result, idx) => {
    const subtenant = String(result.scenario.subtenantName || "").trim();
    sheet.getCell(row, 3 + idx).value = subtenant
      ? `${result.summary.scenarioName}\nSubtenant: ${subtenant}`
      : result.summary.scenarioName;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  const rows = buildComparisonRows(existing, resultRows);
  for (const item of rows) {
    sheet.getCell(row, 1).value = item.label;
    sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    item.values.forEach((value, idx) => {
      const cell = sheet.getCell(row, 2 + idx);
      cell.value = value as number | string;
      cell.alignment = typeof value === "number"
        ? { horizontal: "right", vertical: "middle" }
        : { horizontal: "left", vertical: "middle", wrapText: true };
      if (typeof value === "number") {
        if (item.format === "currency0") cell.numFmt = NUM_FMT.currency0;
        if (item.format === "percent") cell.numFmt = NUM_FMT.percent2;
        if (item.format === "integer") cell.numFmt = NUM_FMT.integer;
      }
    });
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: row + 1,
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
    fitToHeight: 1,
  });
}

function writeExistingCashFlowSheet(
  workbook: ExcelJS.Workbook,
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  branding: SubleaseRecoveryExportBranding,
): void {
  const baseline = results[0]?.monthly ?? [];
  const sheet = workbook.addWorksheet("Existing Obligation Cash Flow", {
    views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
  });
  sheet.columns = [
    { width: 10 },
    { width: 13 },
    { width: 14 },
    { width: 15 },
    { width: 16 },
    { width: 12 },
    { width: 17 },
    { width: 16 },
    { width: 14 },
  ];
  const totalCols = 9;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    "Existing Obligation Monthly Cash Flow",
    totalCols,
    branding,
  );

  const headers = [
    "Month #",
    "Date",
    "Occupied RSF",
    "Base Rent",
    "Operating Expenses",
    "Parking",
    "Gross Monthly Rent",
    "Abatements/Credits",
    "Net Monthly Rent",
  ];
  headers.forEach((header, idx) => { sheet.getCell(row, idx + 1).value = header; });
  styleTableHeader(sheet, row, 1, headers.length);
  const headerRow = row;
  row += 1;

  for (const month of baseline) {
    sheet.getCell(row, 1).value = month.monthNumber;
    sheet.getCell(row, 2).value = toDateLabel(month.date);
    sheet.getCell(row, 3).value = month.occupiedRsf;
    sheet.getCell(row, 4).value = month.baseRent;
    sheet.getCell(row, 5).value = month.operatingExpenses;
    sheet.getCell(row, 6).value = month.parking;
    sheet.getCell(row, 7).value = month.grossMonthlyRent;
    sheet.getCell(row, 8).value = month.abatementsOrCredits;
    sheet.getCell(row, 9).value = month.netMonthlyRent;
    sheet.getCell(row, 3).numFmt = NUM_FMT.integer;
    for (const c of [4, 5, 6, 7, 8, 9]) {
      sheet.getCell(row, c).numFmt = NUM_FMT.currency0;
      sheet.getCell(row, c).alignment = { horizontal: "right", vertical: "middle" };
    }
    sheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }

  const totalRow = row;
  sheet.getCell(totalRow, 1).value = "Total";
  sheet.mergeCells(totalRow, 1, totalRow, 3);
  for (const c of [4, 5, 6, 7, 8, 9]) {
    const letter = String.fromCharCode(64 + c);
    sheet.getCell(totalRow, c).value = { formula: `SUM(${letter}${headerRow + 1}:${letter}${totalRow - 1})` };
    sheet.getCell(totalRow, c).numFmt = NUM_FMT.currency0;
    sheet.getCell(totalRow, c).alignment = { horizontal: "right", vertical: "middle" };
  }
  styleTableHeader(sheet, totalRow, 1, totalCols);

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: totalRow + 1,
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
    fitToHeight: 0,
  });

  void existing;
}

function writeScenarioCashFlowSheet(
  workbook: ExcelJS.Workbook,
  result: SubleaseScenarioResult,
  branding: SubleaseRecoveryExportBranding,
): void {
  const sheetName = safeSheetName(`${result.summary.scenarioName} Cash Flow`, "Scenario Cash Flow");
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
  });
  sheet.columns = [
    { width: 9 },
    { width: 13 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 17 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
  ];
  const totalCols = 13;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    `${result.summary.scenarioName} Monthly Cash Flow`,
    totalCols,
    branding,
  );
  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = `Subtenant: ${result.scenario.subtenantName || "—"} | Source: ${
    result.scenario.sourceType === "proposal_import"
      ? (result.scenario.sourceDocumentName || "Imported proposal")
      : "Manual scenario"
  }`;
  styleTableBodyRow(sheet, row, 1, totalCols, false);
  row += 1;
  const headers = [
    "Month #",
    "Date",
    "Occupied RSF",
    "Base Rent",
    "Operating Expenses",
    "Parking",
    "TI Amortization",
    "Gross Monthly Rent",
    "Abatements/Credits",
    "Net Monthly Rent",
    "One-Time Costs",
    "Sublease Recovery",
    "Net Obligation",
  ];
  headers.forEach((header, idx) => { sheet.getCell(row, idx + 1).value = header; });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  for (const month of result.monthly) {
    sheet.getCell(row, 1).value = month.monthNumber;
    sheet.getCell(row, 2).value = toDateLabel(month.date);
    sheet.getCell(row, 3).value = month.occupiedRsf;
    sheet.getCell(row, 4).value = month.baseRent;
    sheet.getCell(row, 5).value = month.operatingExpenses;
    sheet.getCell(row, 6).value = month.parking;
    sheet.getCell(row, 7).value = month.tiAmortization;
    sheet.getCell(row, 8).value = month.grossMonthlyRent;
    sheet.getCell(row, 9).value = month.abatementsOrCredits;
    sheet.getCell(row, 10).value = month.netMonthlyRent;
    sheet.getCell(row, 11).value = month.oneTimeCosts;
    sheet.getCell(row, 12).value = month.subleaseRecovery;
    sheet.getCell(row, 13).value = month.netObligation;
    sheet.getCell(row, 3).numFmt = NUM_FMT.integer;
    for (const c of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      sheet.getCell(row, c).numFmt = NUM_FMT.currency0;
      sheet.getCell(row, c).alignment = { horizontal: "right", vertical: "middle" };
    }
    sheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle" };
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }

  const totalRow = row;
  sheet.getCell(totalRow, 1).value = "Total";
  sheet.mergeCells(totalRow, 1, totalRow, 3);
  for (let c = 4; c <= totalCols; c += 1) {
    const letter = String.fromCharCode(64 + c);
    sheet.getCell(totalRow, c).value = { formula: `SUM(${letter}${headerRow + 1}:${letter}${totalRow - 1})` };
    sheet.getCell(totalRow, c).numFmt = NUM_FMT.currency0;
    sheet.getCell(totalRow, c).alignment = { horizontal: "right", vertical: "middle" };
  }
  styleTableHeader(sheet, totalRow, 1, totalCols);

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: totalRow + 1,
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
    fitToHeight: 0,
  });
}

function writeSensitivitySheet(
  workbook: ExcelJS.Workbook,
  sensitivity: SensitivityResult,
  branding: SubleaseRecoveryExportBranding,
): void {
  const sheet = workbook.addWorksheet("Sensitivity Analysis", {
    views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
  });
  const totalCols = Math.max(4, sensitivity.baseRentValues.length + 1);
  sheet.columns = [{ width: 22 }, ...Array.from({ length: totalCols - 1 }, () => ({ width: 20 }))];

  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    "Sensitivity analysis across downtime and rent assumptions",
    totalCols,
    branding,
  );

  sheet.getCell(row, 1).value = "Downtime / Base Rent";
  sensitivity.baseRentValues.forEach((baseRent, idx) => {
    sheet.getCell(row, idx + 2).value = `Rent ${idx + 1}: ${toCurrency(baseRent)}`;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const matrixHeader = row;
  row += 1;

  for (const downtime of sensitivity.downtimeValues) {
    sheet.getCell(row, 1).value = `${downtime} months`;
    sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle" };
    sensitivity.baseRentValues.forEach((rent, idx) => {
      const point = sensitivity.matrix.find((item) => item.downtimeMonths === downtime && item.baseRent === rent);
      const cell = sheet.getCell(row, idx + 2);
      if (!point) {
        cell.value = "—";
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.value = `${toCurrency(point.netObligation)} | ${toPercent(point.recoveryPercent)}`;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      }
    });
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }
  row += 1;

  const singleSensitivity = [
    { label: "Term", points: sensitivity.termSensitivity },
    { label: "Commission", points: sensitivity.commissionSensitivity },
    { label: "TI + Legal", points: sensitivity.tiLegalSensitivity },
    { label: "Operating Expense", points: sensitivity.opexSensitivity },
  ];

  for (const block of singleSensitivity) {
    sheet.mergeCells(row, 1, row, 4);
    sheet.getCell(row, 1).value = `${block.label} Sensitivity`;
    styleTableHeader(sheet, row, 1, 4);
    row += 1;
    sheet.getCell(row, 1).value = "Case";
    sheet.getCell(row, 2).value = "Net Obligation";
    sheet.getCell(row, 3).value = "Recovery %";
    sheet.getCell(row, 4).value = "Comment";
    styleTableHeader(sheet, row, 1, 4);
    row += 1;
    for (const point of block.points) {
      sheet.getCell(row, 1).value = point.label;
      sheet.getCell(row, 2).value = point.netObligation;
      sheet.getCell(row, 3).value = point.recoveryPercent;
      sheet.getCell(row, 4).value = point.label === "Base" ? "Current assumption" : "Sensitivity case";
      sheet.getCell(row, 2).numFmt = NUM_FMT.currency0;
      sheet.getCell(row, 3).numFmt = NUM_FMT.percent2;
      sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle" };
      sheet.getCell(row, 2).alignment = { horizontal: "right", vertical: "middle" };
      sheet.getCell(row, 3).alignment = { horizontal: "right", vertical: "middle" };
      sheet.getCell(row, 4).alignment = { horizontal: "left", vertical: "middle" };
      styleTableBodyRow(sheet, row, 1, 4, row % 2 === 0);
      row += 1;
    }
    row += 1;
  }

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: row + 1,
    lastCol: totalCols,
    repeatHeaderRow: matrixHeader,
    fitToHeight: 0,
  });
}

function writeAssumptionsSheet(
  workbook: ExcelJS.Workbook,
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  branding: SubleaseRecoveryExportBranding,
): void {
  const sheet = workbook.addWorksheet("Assumptions", {
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
  });
  sheet.columns = [{ width: 30 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }];
  const totalCols = 5;
  let row = addBrandedHeader(
    workbook,
    sheet,
    "Sublease Recovery Analysis",
    "Assumptions reference for baseline and scenarios",
    totalCols,
    branding,
  );

  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Existing Obligation Assumptions";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const existingAssumptions: Array<[string, string | number]> = [
    ["Premises", existing.premises],
    ["Rentable Square Footage", existing.rsf],
    ["Commencement", toDateLabel(existing.commencementDate)],
    ["Expiration", toDateLabel(existing.expirationDate)],
    ["Lease Type", String(existing.leaseType).toUpperCase()],
    ["Base Operating Expense ($/SF/YR)", existing.baseOperatingExpense],
    ["Annual OpEx Escalation", existing.annualOperatingExpenseEscalation],
    ["Parking Ratio", existing.parkingRatio],
    ["Allotted Parking Spaces", existing.allottedParkingSpaces],
    ["Parking Cost per Space (Monthly)", existing.parkingCostPerSpace],
    ["Parking Sales Tax", existing.parkingSalesTax],
  ];

  for (const [label, value] of existingAssumptions) {
    sheet.getCell(row, 1).value = label;
    sheet.mergeCells(row, 2, row, totalCols);
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = value;
    valueCell.alignment = { horizontal: typeof value === "number" ? "right" : "left", vertical: "middle", wrapText: true };
    if (typeof value === "number") {
      if (label.includes("Escalation") || label.includes("Tax")) valueCell.numFmt = NUM_FMT.percent2;
      else if (label.includes("Square Footage") || label.includes("Spaces") || label.includes("Ratio")) valueCell.numFmt = NUM_FMT.integer;
      else valueCell.numFmt = NUM_FMT.currency2;
    }
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  }
  row += 1;

  for (const result of results) {
    const scenario = result.scenario;
    sheet.mergeCells(row, 1, row, totalCols);
    sheet.getCell(row, 1).value = `Scenario Assumptions — ${scenario.name}`;
    styleTableHeader(sheet, row, 1, totalCols);
    row += 1;
    const entries: Array<[string, string | number]> = [
      ["Scenario Name", scenario.name],
      ["Subtenant Name", scenario.subtenantName || "—"],
      ["Subtenant Legal Entity", scenario.subtenantLegalEntity || "—"],
      ["Scenario Source", scenario.sourceType === "proposal_import" ? `Imported (${scenario.sourceDocumentName || "Proposal"})` : "Manual"],
      ["Downtime (months)", scenario.downtimeMonths],
      ["Sublease Commencement", toDateLabel(scenario.subleaseCommencementDate)],
      ["Sublease Term (months)", scenario.subleaseTermMonths],
      ["Sublease Expiration", toDateLabel(scenario.subleaseExpirationDate)],
      ["Sublease RSF", scenario.rsf],
      ["Lease Type", String(scenario.leaseType).toUpperCase()],
      ["Base Rent Input", scenario.baseRent],
      ["Rent Input Type", scenario.rentInputType === "annual_psf" ? "Annual per RSF" : "Monthly amount"],
      ["Annual Base Rent Escalation", scenario.annualBaseRentEscalation],
      ["Escalation Type", scenario.rentEscalationType],
      ["Base Operating Expense ($/SF/YR)", scenario.baseOperatingExpense],
      ["Annual OpEx Escalation", scenario.annualOperatingExpenseEscalation],
      ["Rent Abatement Start", toDateLabel(scenario.rentAbatementStartDate)],
      ["Rent Abatement Months", scenario.rentAbatementMonths],
      ["Rent Abatement Type", scenario.rentAbatementType],
      ["Commission %", scenario.commissionPercent],
      ["Construction Budget", scenario.constructionBudget],
      ["TI Allowance to Subtenant", scenario.tiAllowanceToSubtenant],
      ["Legal and Misc. Fees", scenario.legalMiscFees],
      ["Other One-Time Costs", scenario.otherOneTimeCosts],
      ["Parking Ratio", scenario.parkingRatio],
      ["Allotted Spaces", scenario.allottedParkingSpaces],
      ["Reserved Paid Spaces", scenario.reservedPaidSpaces],
      ["Unreserved Paid Spaces", scenario.unreservedPaidSpaces],
      ["Parking Cost per Space (Monthly)", scenario.parkingCostPerSpace],
      ["Annual Parking Escalation", scenario.annualParkingEscalation],
      ["Discount Rate", scenario.discountRate],
    ];
    for (const [label, value] of entries) {
      sheet.getCell(row, 1).value = label;
      sheet.mergeCells(row, 2, row, totalCols);
      const valueCell = sheet.getCell(row, 2);
      valueCell.value = value;
      valueCell.alignment = { horizontal: typeof value === "number" ? "right" : "left", vertical: "middle", wrapText: true };
      if (typeof value === "number") {
        if (label.includes("%") || label.includes("Escalation") || label.includes("Discount Rate")) valueCell.numFmt = NUM_FMT.percent2;
        else if (label.includes("months") || label.includes("RSF") || label.includes("Spaces") || label.includes("Ratio")) valueCell.numFmt = NUM_FMT.integer;
        else valueCell.numFmt = NUM_FMT.currency2;
      }
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    }
    if (scenario.phaseInEvents.length > 0) {
      sheet.getCell(row, 1).value = "Rent Phase-In Events";
      sheet.getCell(row, 2).value = scenario.phaseInEvents
        .map((event) => `${toDateLabel(event.startDate)} (+${event.rsfIncrease.toLocaleString()} RSF)`)
        .join(" | ");
      sheet.mergeCells(row, 2, row, totalCols);
      sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    }
    if ((scenario.explicitBaseRentSchedule || []).length > 1) {
      sheet.getCell(row, 1).value = "Explicit Rent Schedule";
      sheet.getCell(row, 2).value = (scenario.explicitBaseRentSchedule || [])
        .map((step) => `M${step.startMonth + 1}-M${step.endMonth + 1}: ${toCurrency(step.annualRatePsf)}/SF/YR`)
        .join(" | ");
      sheet.mergeCells(row, 2, row, totalCols);
      sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    }
    row += 1;
  }

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: row + 1,
    lastCol: totalCols,
    fitToHeight: 0,
  });
}

export async function buildSubleaseRecoveryWorkbook(
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  sensitivity: SensitivityResult,
  branding: SubleaseRecoveryExportBranding = {},
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = EXPORT_BRAND.name;
  workbook.created = new Date();

  writeSummarySheet(workbook, existing, results, branding);
  writeScenarioComparisonSheet(workbook, existing, results, branding);
  writeExistingCashFlowSheet(workbook, existing, results, branding);
  results.forEach((result) => writeScenarioCashFlowSheet(workbook, result, branding));
  writeSensitivitySheet(workbook, sensitivity, branding);
  writeAssumptionsSheet(workbook, existing, results, branding);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function renderPdfPage(
  bodyHtml: string,
  pageNumber: number,
  totalPages: number,
  branding: SubleaseRecoveryExportBranding,
): string {
  const brokerage = String(branding.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name;
  const client = String(branding.clientName || "Client").trim() || "Client";
  const reportDate = String(branding.reportDate || formatDateMmDdYyyy(new Date()));
  const logo = branding.brokerageLogoDataUrl
    ? `<img class="brand-logo" src="${escHtml(branding.brokerageLogoDataUrl)}" alt="${escHtml(brokerage)}" />`
    : `<div class="brand-wordmark">${escHtml(brokerage)}</div>`;
  const clientLogo = branding.clientLogoDataUrl
    ? `<img class="client-logo" src="${escHtml(branding.clientLogoDataUrl)}" alt="${escHtml(client)}" />`
    : "";

  return `
    <section class="pdf-page">
      <header class="page-header">
        <div class="brand-wrap">${logo}</div>
        <div class="report-meta">
          ${clientLogo ? `<div class="client-logo-wrap">${clientLogo}</div>` : ""}
          <div class="report-title">Sublease Recovery Analysis</div>
          <div class="report-sub">${escHtml(client)} | ${escHtml(reportDate)}</div>
        </div>
      </header>
      <div class="page-content">
        ${bodyHtml}
      </div>
      <footer class="page-footer">
        <span>${escHtml(brokerage)} · thecremodel.com</span>
        <span>Page ${pageNumber} of ${totalPages}</span>
      </footer>
    </section>
  `;
}

function scenarioComparisonTableHtml(existing: ExistingObligation, results: SubleaseScenarioResult[]): string {
  const headers = [
    "<th>Scenario</th>",
    "<th>Subtenant</th>",
    "<th>Source</th>",
    "<th>Total Remaining Obligation</th>",
    "<th>Total Sublease Recovery</th>",
    "<th>Total Sublease Costs</th>",
    "<th>Net Sublease Recovery</th>",
    "<th>Net Obligation</th>",
    "<th>Recovery %</th>",
    "<th>NPV</th>",
  ].join("");
  const rows = results
    .map((result) => `
      <tr>
        <td>${escHtml(result.summary.scenarioName)}</td>
        <td>${escHtml(result.scenario.subtenantName || "—")}</td>
        <td>${escHtml(
          result.scenario.sourceType === "proposal_import"
            ? (result.scenario.sourceDocumentName || "Imported proposal")
            : "Manual"
        )}</td>
        <td>${escHtml(toCurrency(result.summary.totalRemainingObligation))}</td>
        <td>${escHtml(toCurrency(result.summary.totalSubleaseRecovery))}</td>
        <td>${escHtml(toCurrency(result.summary.totalSubleaseCosts))}</td>
        <td>${escHtml(toCurrency(result.summary.netSubleaseRecovery))}</td>
        <td>${escHtml(toCurrency(result.summary.netObligation))}</td>
        <td>${escHtml(toPercent(result.summary.recoveryPercent))}</td>
        <td>${escHtml(toCurrency(result.summary.npv))}</td>
      </tr>
    `)
    .join("");

  return `
    <article class="panel">
      <p class="kicker">Scenario Comparison</p>
      <h2 class="section-title">Recovery Outcome Grid</h2>
      <p class="section-subtitle">Existing obligation is benchmarked against each sublease scenario using the same monthly engine assumptions.</p>
      <table class="data-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="table-footnote">
        Existing obligation: ${escHtml(existing.premises)} (${escHtml(existing.rsf.toLocaleString())} RSF, ${escHtml(toDateLabel(existing.commencementDate))} - ${escHtml(toDateLabel(existing.expirationDate))})
      </p>
    </article>
  `;
}

function assumptionsHtml(results: SubleaseScenarioResult[]): string {
  const cards = results
    .map((result) => {
      const scenario = result.scenario;
      return `
        <article class="assumption-card">
          <h3>${escHtml(scenario.name)}</h3>
          <dl>
            <dt>Subtenant</dt><dd>${escHtml(scenario.subtenantName || "—")}</dd>
            <dt>Source</dt><dd>${escHtml(
              scenario.sourceType === "proposal_import"
                ? (scenario.sourceDocumentName || "Imported proposal")
                : "Manual"
            )}</dd>
            <dt>Downtime</dt><dd>${escHtml(`${scenario.downtimeMonths} months`)}</dd>
            <dt>Commencement</dt><dd>${escHtml(toDateLabel(scenario.subleaseCommencementDate))}</dd>
            <dt>Term</dt><dd>${escHtml(`${scenario.subleaseTermMonths} months`)}</dd>
            <dt>Base Rent Input</dt><dd>${escHtml(toCurrency(scenario.baseRent))}${scenario.rentInputType === "annual_psf" ? " / SF / YR" : " / Month"}</dd>
            <dt>Rent Escalation</dt><dd>${escHtml(toPercent(scenario.annualBaseRentEscalation))} (${escHtml(scenario.rentEscalationType)})</dd>
            <dt>OpEx Escalation</dt><dd>${escHtml(toPercent(scenario.annualOperatingExpenseEscalation))}</dd>
            <dt>Abatement</dt><dd>${escHtml(`${scenario.rentAbatementMonths} months (${scenario.rentAbatementType})`)}</dd>
            <dt>Commission</dt><dd>${escHtml(toPercent(scenario.commissionPercent))}</dd>
            <dt>TI + Legal + Other</dt><dd>${escHtml(toCurrency(scenario.constructionBudget + scenario.tiAllowanceToSubtenant + scenario.legalMiscFees + scenario.otherOneTimeCosts))}</dd>
          </dl>
        </article>
      `;
    })
    .join("");

  return `
    <article class="panel">
      <p class="kicker">Assumptions</p>
      <h2 class="section-title">Scenario Input Summary</h2>
      <div class="assumption-grid">${cards}</div>
    </article>
  `;
}

function sensitivityHtml(sensitivity: SensitivityResult): string {
  const header = ["<th>Downtime \\ Base Rent</th>", ...sensitivity.baseRentValues.map((v) => `<th>${escHtml(toCurrency(v))}</th>`)].join("");
  const rows = sensitivity.downtimeValues
    .map((downtime) => {
      const cells = sensitivity.baseRentValues
        .map((rent) => {
          const point = sensitivity.matrix.find((item) => item.downtimeMonths === downtime && item.baseRent === rent);
          if (!point) return "<td>—</td>";
          return `<td>${escHtml(toCurrency(point.netObligation))}<br/><span class="cell-sub">${escHtml(toPercent(point.recoveryPercent))}</span></td>`;
        })
        .join("");
      return `<tr><th>${escHtml(`${downtime} months`)}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <article class="panel">
      <p class="kicker">Sensitivity</p>
      <h2 class="section-title">Downtime and Base Rent Matrix</h2>
      <p class="section-subtitle">Each cell shows net obligation with recovery percentage for the matching downtime and base rent assumptions.</p>
      <table class="data-table matrix-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>
  `;
}

function cashflowSnapshotHtml(results: SubleaseScenarioResult[]): string {
  const blocks = results
    .map((result) => {
      const sample = result.monthly.slice(0, 12);
      const rows = sample
        .map((month) => `
          <tr>
            <td>${month.monthNumber}</td>
            <td>${escHtml(toDateLabel(month.date))}</td>
            <td>${escHtml(toCurrency(month.netMonthlyRent))}</td>
            <td>${escHtml(toCurrency(month.subleaseRecovery))}</td>
            <td>${escHtml(toCurrency(month.oneTimeCosts + month.tiAmortization))}</td>
            <td>${escHtml(toCurrency(month.netObligation))}</td>
          </tr>
        `)
        .join("");
      return `
        <article class="panel">
          <p class="kicker">Monthly Snapshot</p>
          <h3 class="scenario-title">${escHtml(result.summary.scenarioName)}</h3>
          <p class="section-subtitle">Subtenant: ${escHtml(result.scenario.subtenantName || "—")} · Source: ${escHtml(
            result.scenario.sourceType === "proposal_import"
              ? (result.scenario.sourceDocumentName || "Imported proposal")
              : "Manual"
          )}</p>
          <table class="data-table compact-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Date</th>
                <th>Existing Net Rent</th>
                <th>Sublease Recovery</th>
                <th>Sublease Costs</th>
                <th>Net Obligation</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="table-footnote">Showing first 12 months. Full monthly schedules are included in the Excel export.</p>
        </article>
      `;
    })
    .join("");

  return `<div class="stack">${blocks}</div>`;
}

function buildSubleaseRecoveryPdfHtml(
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  sensitivity: SensitivityResult | null,
  branding: SubleaseRecoveryExportBranding,
): string {
  const pdfTitle = buildSubleaseRecoveryExportFileName("pdf", branding).replace(/\.pdf$/i, "");
  const kpis = results
    .map((result) => `
      <article class="kpi-card">
        <p class="kpi-label">${escHtml(result.summary.scenarioName)}</p>
        <p class="kpi-sub">Subtenant: ${escHtml(result.scenario.subtenantName || "—")}</p>
        <p class="kpi-value">${escHtml(toCurrency(result.summary.netObligation))}</p>
        <p class="kpi-sub">Net Obligation</p>
        <p class="kpi-micro">Recovery ${escHtml(toPercent(result.summary.recoveryPercent))} · NPV ${escHtml(toCurrency(result.summary.npv))}</p>
      </article>
    `)
    .join("");

  const pageBodies: string[] = [];
  pageBodies.push(`
    <article class="panel hero-panel">
      <p class="kicker">Sublease Recovery</p>
      <h1 class="hero-title">Economic Presentation</h1>
      <p class="section-subtitle">Scenario-based analysis of recovery potential against remaining lease obligation.</p>
      <div class="meta-grid">
        <div><span>Premises</span><strong>${escHtml(existing.premises)}</strong></div>
        <div><span>RSF</span><strong>${escHtml(existing.rsf.toLocaleString())}</strong></div>
        <div><span>Lease Window</span><strong>${escHtml(`${toDateLabel(existing.commencementDate)} - ${toDateLabel(existing.expirationDate)}`)}</strong></div>
        <div><span>Scenario Count</span><strong>${results.length}</strong></div>
      </div>
    </article>
    <section class="kpi-grid">${kpis}</section>
  `);
  pageBodies.push(scenarioComparisonTableHtml(existing, results));
  pageBodies.push(assumptionsHtml(results));
  if (sensitivity) pageBodies.push(sensitivityHtml(sensitivity));
  pageBodies.push(cashflowSnapshotHtml(results));

  const pages = pageBodies.map((body, idx) => renderPdfPage(body, idx + 1, pageBodies.length, branding)).join("\n");

  return `
    <html>
      <head>
        <title>${escHtml(pdfTitle)}</title>
        <style>
          @page { size: letter portrait; margin: 0.42in; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: ${EXPORT_BRAND.pdf.colors.ink};
            font-family: ${EXPORT_BRAND.pdf.fonts.family};
            background: #ffffff;
          }
          .pdf-page {
            position: relative;
            min-height: 10.1in;
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            padding: 0.2in 0.24in 0.18in;
            page-break-after: always;
            display: flex;
            flex-direction: column;
          }
          .pdf-page:last-child { page-break-after: auto; }
          .page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            padding-bottom: 10px;
            margin-bottom: 14px;
          }
          .brand-logo { max-height: 38px; max-width: 180px; object-fit: contain; }
          .brand-wordmark {
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .report-meta { text-align: right; }
          .client-logo-wrap { margin-bottom: 5px; }
          .client-logo { max-height: 26px; max-width: 120px; object-fit: contain; }
          .report-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.13em;
            text-transform: uppercase;
          }
          .report-sub {
            font-size: 10px;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
            margin-top: 3px;
          }
          .page-content { flex: 1; display: flex; flex-direction: column; gap: 12px; }
          .page-footer {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          .panel {
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            background: #fff;
            padding: 12px 14px;
          }
          .hero-panel {
            background: linear-gradient(180deg, ${EXPORT_BRAND.pdf.colors.panelFill} 0%, #ffffff 100%);
          }
          .kicker {
            margin: 0 0 6px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
          }
          .hero-title, .section-title {
            margin: 0;
            font-size: 29px;
            line-height: 1.1;
            font-weight: 700;
            color: ${EXPORT_BRAND.pdf.colors.ink};
          }
          .section-title { font-size: 22px; }
          .scenario-title {
            margin: 0 0 8px;
            font-size: 16px;
            font-weight: 700;
          }
          .section-subtitle {
            margin: 8px 0 0;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
            font-size: 11px;
            line-height: 1.35;
          }
          .meta-grid {
            margin-top: 14px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .meta-grid div {
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            background: #fff;
            padding: 8px 9px;
          }
          .meta-grid span {
            display: block;
            font-size: 9px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
            margin-bottom: 3px;
          }
          .meta-grid strong { font-size: 13px; }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .kpi-card {
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            background: #fff;
            padding: 10px 12px;
          }
          .kpi-label {
            margin: 0;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
          }
          .kpi-value {
            margin: 4px 0 0;
            font-size: 24px;
            font-weight: 700;
            line-height: 1.05;
          }
          .kpi-sub { margin: 4px 0 0; font-size: 10px; color: ${EXPORT_BRAND.pdf.colors.subtext}; }
          .kpi-micro { margin: 6px 0 0; font-size: 10px; color: ${EXPORT_BRAND.pdf.colors.ink}; }
          .data-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 10px;
          }
          .data-table thead th {
            background: ${EXPORT_BRAND.pdf.colors.accent};
            color: #ffffff;
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            font-size: 9px;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            text-align: center;
            padding: 6px 5px;
          }
          .data-table tbody th,
          .data-table tbody td {
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            padding: 6px 6px;
            font-size: 10px;
            vertical-align: top;
          }
          .data-table tbody tr:nth-child(even) td,
          .data-table tbody tr:nth-child(even) th { background: ${EXPORT_BRAND.pdf.colors.mutedFill}; }
          .data-table tbody td:not(:first-child),
          .data-table tbody th:not(:first-child) { text-align: right; }
          .data-table tbody td:first-child,
          .data-table tbody th:first-child { text-align: left; font-weight: 600; }
          .matrix-table tbody td { text-align: center !important; }
          .cell-sub { color: ${EXPORT_BRAND.pdf.colors.subtext}; font-size: 9px; }
          .table-footnote {
            margin: 8px 0 0;
            font-size: 9px;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
          }
          .assumption-grid {
            margin-top: 10px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .assumption-card {
            border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
            background: #fff;
            padding: 9px 10px;
          }
          .assumption-card h3 {
            margin: 0 0 7px;
            font-size: 14px;
          }
          .assumption-card dl {
            margin: 0;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3px 8px;
          }
          .assumption-card dt {
            margin: 0;
            font-size: 9px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: ${EXPORT_BRAND.pdf.colors.subtext};
          }
          .assumption-card dd {
            margin: 0;
            font-size: 10px;
            text-align: right;
          }
          .stack {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .compact-table thead th,
          .compact-table tbody td {
            font-size: 9px;
            padding: 5px;
          }
        </style>
      </head>
      <body>${pages}</body>
    </html>
  `;
}

export function printSubleaseRecoverySummary(
  existing: ExistingObligation,
  results: SubleaseScenarioResult[],
  sensitivity: SensitivityResult | null,
  branding: SubleaseRecoveryExportBranding = {},
): void {
  const html = buildSubleaseRecoveryPdfHtml(existing, results, sensitivity, branding);
  const popup = window.open("", "_blank", "width=1280,height=920");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function buildSubleaseRecoveryExportFileName(
  kind: "xlsx" | "pdf",
  branding: SubleaseRecoveryExportBranding,
): string {
  return buildPlatformExportFileName({
    kind,
    brokerageName: branding.brokerageName,
    clientName: branding.clientName,
    reportDate: branding.reportDate,
    excelDescriptor: "Sublease Recovery Financial Analysis",
    pdfDescriptor: "Sublease Recovery Economic Presentation",
  });
}
