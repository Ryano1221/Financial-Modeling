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

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
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

  const sheet = workbook.addWorksheet("Surveys");
  const reportMeta = resolveExportBranding(branding);

  sheet.columns = [
    { width: 26 },
    { width: 26 },
    { width: 14 },
    { width: 12 },
    { width: 20 },
    { width: 16 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 20 },
  ];

  sheet.mergeCells(1, 1, 2, 15);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "Survey Comparison";
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  titleCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.subtitleSize, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 20;
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, 15);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = buildExportMetaLine(reportMeta);
  metaCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.labelSize, color: { argb: COLORS.secondaryText }, bold: true };
  metaCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 18;

  const headerRow = 5;
  const headers = [
    "Building",
    "Address",
    "Suite/Floor",
    "Type",
    "Sublessor",
    "Sublease Exp.",
    "Lease Type",
    "Available RSF",
    "Base Rent ($/SF/YR)",
    "OpEx ($/SF/YR)",
    "Parking (Spaces)",
    "Parking Rate",
    "Monthly Occupancy",
    "Review Status",
    "Notes",
  ];
  headers.forEach((header, idx) => {
    const cell = sheet.getCell(headerRow, idx + 1);
    cell.value = header;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
    cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.labelSize, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  });
  sheet.getRow(headerRow).height = 22;

  let row = headerRow + 1;
  entries.forEach((entry, idx) => {
    const cost = computeSurveyMonthlyOccupancyCost(entry);
    const suiteFloor = [entry.suite, entry.floor].filter(Boolean).join(" / ");
    const review = entry.needsReview ? "Needs Review" : "Ready";
    const values = [
      entry.buildingName || "-",
      entry.address || "-",
      suiteFloor || "-",
      entry.occupancyType,
      entry.sublessor || "-",
      entry.subleaseExpirationDate || "-",
      entry.leaseType,
      entry.availableSqft,
      entry.baseRentPsfAnnual,
      entry.opexPsfAnnual,
      entry.parkingSpaces,
      entry.parkingRateMonthlyPerSpace,
      cost.totalMonthly,
      review,
      entry.notes || "",
    ];
    values.forEach((value, idxCol) => {
      const cell = sheet.getCell(row, idxCol + 1);
      cell.value = value as string | number;
      cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
      cell.alignment = { horizontal: typeof value === "number" ? "right" : "left", vertical: "middle", wrapText: true };
      if (idxCol === 7) cell.numFmt = NUM_FMT.integer;
      if (idxCol === 8 || idxCol === 9) cell.numFmt = NUM_FMT.currency2;
      if (idxCol === 10) cell.numFmt = NUM_FMT.integer;
      if (idxCol === 11 || idxCol === 12) cell.numFmt = NUM_FMT.currency0;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : COLORS.mutedFill } };
      cell.border = {
        top: { style: "thin", color: { argb: COLORS.border } },
        bottom: { style: "thin", color: { argb: COLORS.border } },
        left: { style: "thin", color: { argb: COLORS.border } },
        right: { style: "thin", color: { argb: COLORS.border } },
      };
    });
    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: true,
    lastRow: Math.max(row, headerRow + 2),
    lastCol: 15,
    repeatHeaderRow: headerRow,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function printSurveysPdf(entries: SurveyEntry[], branding: SurveysExportBranding = {}): void {
  const reportMeta = resolveExportBranding(branding);

  const rows = entries
    .map((entry) => {
      const cost = computeSurveyMonthlyOccupancyCost(entry);
      const suiteFloor = [entry.suite, entry.floor].filter(Boolean).join(" / ");
      return `<tr>
        <td>${escapeHtml(entry.buildingName || "-")}</td>
        <td>${escapeHtml(entry.address || "-")}</td>
        <td>${escapeHtml(suiteFloor || "-")}</td>
        <td>${escapeHtml(entry.occupancyType)}</td>
        <td>${escapeHtml(entry.sublessor || "-")}</td>
        <td>${escapeHtml(entry.subleaseExpirationDate || "-")}</td>
        <td>${escapeHtml(entry.leaseType)}</td>
        <td style="text-align:right">${escapeHtml(entry.availableSqft.toLocaleString("en-US"))}</td>
        <td style="text-align:right">${escapeHtml(toCurrency(entry.baseRentPsfAnnual))}</td>
        <td style="text-align:right">${escapeHtml(toCurrency(entry.opexPsfAnnual))}</td>
        <td style="text-align:right">${escapeHtml(toCurrency(cost.totalMonthly))}</td>
        <td>${escapeHtml(entry.needsReview ? "Needs Review" : "Ready")}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(buildSurveysExportFileName("pdf", branding).replace(/\.pdf$/i, ""))}</title>
      <style>
        @page { size: letter landscape; margin: 0.45in; }
        body { margin: 0; font-family: ${EXPORT_BRAND.pdf.fonts.family}; color: ${EXPORT_BRAND.pdf.colors.ink}; }
        .page { border: 1px solid ${EXPORT_BRAND.pdf.colors.border}; padding: 16px; }
        .title { font-size: 28px; font-weight: 700; margin: 0 0 8px; }
        .meta { font-size: 12px; color: ${EXPORT_BRAND.pdf.colors.subtext}; margin: 0 0 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th, td { border: 1px solid ${EXPORT_BRAND.pdf.colors.border}; padding: 5px; vertical-align: top; }
        th { background: ${EXPORT_BRAND.pdf.colors.mutedFill}; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; }
      </style>
    </head>
    <body>
      <section class="page">
        <p class="title">Survey Comparison</p>
        <p class="meta">${escapeHtml(reportMeta.brokerageName)} | ${escapeHtml(reportMeta.clientName)} | Prepared by ${escapeHtml(reportMeta.preparedBy)} | Report Date ${escapeHtml(reportMeta.reportDate)}</p>
        <table>
          <thead>
            <tr>
              <th>Building</th>
              <th>Address</th>
              <th>Suite/Floor</th>
              <th>Type</th>
              <th>Sublessor</th>
              <th>Sublease Exp.</th>
              <th>Lease Type</th>
              <th>RSF</th>
              <th>Base Rent</th>
              <th>OpEx</th>
              <th>Monthly Occupancy</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </body>
  </html>`;

  openPrintWindow(html, { width: 1280, height: 900 });
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

  // Backward compatibility for links generated before the unified share envelope.
  const parsed = decodeSharePayload<SurveysSharePayload>(value);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
  return parsed;
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  downloadArrayBufferShared(arrayBuffer, fileName, mimeType);
}
