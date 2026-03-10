import ExcelJS from "exceljs";
import {
  EXCEL_THEME,
  EXPORT_BRAND,
  applyExcelPageSetup,
  buildPlatformExportFileName,
  formatDateMmDdYyyy,
} from "@/lib/export-design";
import { computeSurveyMonthlyOccupancyCost } from "./engine";
import type { SurveyEntry, SurveysExportBranding, SurveysSharePayload } from "./types";

const COLORS = EXPORT_BRAND.excel.colors;
const NUM_FMT = EXPORT_BRAND.excel.numberFormats;

function escHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toDateLabel(raw: string): string {
  const value = String(raw || "").trim();
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function serializeForShare(payload: SurveysSharePayload): string {
  const json = JSON.stringify(payload);
  if (typeof window === "undefined") return "";
  return window.btoa(unescape(encodeURIComponent(json)));
}

function deserializeShare(value: string): SurveysSharePayload | null {
  try {
    if (typeof window === "undefined") return null;
    const json = decodeURIComponent(escape(window.atob(value)));
    const parsed = JSON.parse(json) as SurveysSharePayload;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
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
  const reportDate = String(branding.reportDate || formatDateMmDdYyyy(new Date())).trim();
  const brokerage = String(branding.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name;
  const client = String(branding.clientName || "Client").trim() || "Client";
  const preparedBy = String(branding.preparedBy || "").trim();

  sheet.columns = [
    { width: 26 },
    { width: 26 },
    { width: 14 },
    { width: 12 },
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

  sheet.mergeCells(1, 1, 2, 13);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = "Survey Comparison";
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  titleCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.subtitleSize, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 20;
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, 13);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = `${brokerage} | ${client} | Report Date ${reportDate}${preparedBy ? ` | Prepared by ${preparedBy}` : ""}`;
  metaCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.labelSize, color: { argb: COLORS.secondaryText }, bold: true };
  metaCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 18;

  const headerRow = 5;
  const headers = [
    "Building",
    "Address",
    "Suite/Floor",
    "Type",
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
      if (idxCol === 5) cell.numFmt = NUM_FMT.integer;
      if (idxCol === 6 || idxCol === 7) cell.numFmt = NUM_FMT.currency2;
      if (idxCol === 9 || idxCol === 10) cell.numFmt = NUM_FMT.currency0;
      if (idxCol === 8) cell.numFmt = NUM_FMT.integer;
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
    lastCol: 13,
    repeatHeaderRow: headerRow,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function printSurveysPdf(entries: SurveyEntry[], branding: SurveysExportBranding = {}): void {
  const reportDate = String(branding.reportDate || formatDateMmDdYyyy(new Date())).trim();
  const brokerage = String(branding.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name;
  const client = String(branding.clientName || "Client").trim() || "Client";

  const rows = entries
    .map((entry) => {
      const cost = computeSurveyMonthlyOccupancyCost(entry);
      const suiteFloor = [entry.suite, entry.floor].filter(Boolean).join(" / ");
      return `<tr>
        <td>${escHtml(entry.buildingName || "-")}</td>
        <td>${escHtml(entry.address || "-")}</td>
        <td>${escHtml(suiteFloor || "-")}</td>
        <td>${escHtml(entry.occupancyType)}</td>
        <td>${escHtml(entry.leaseType)}</td>
        <td style="text-align:right">${escHtml(entry.availableSqft.toLocaleString("en-US"))}</td>
        <td style="text-align:right">${escHtml(toCurrency(entry.baseRentPsfAnnual))}</td>
        <td style="text-align:right">${escHtml(toCurrency(entry.opexPsfAnnual))}</td>
        <td style="text-align:right">${escHtml(toCurrency(cost.totalMonthly))}</td>
        <td>${escHtml(entry.needsReview ? "Needs Review" : "Ready")}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escHtml(buildSurveysExportFileName("pdf", branding).replace(/\.pdf$/i, ""))}</title>
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
        <p class="meta">${escHtml(brokerage)} | ${escHtml(client)} | Report Date ${escHtml(reportDate)}</p>
        <table>
          <thead>
            <tr>
              <th>Building</th>
              <th>Address</th>
              <th>Suite/Floor</th>
              <th>Type</th>
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

  const popup = window.open("", "_blank", "width=1280,height=900");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function buildSurveysShareLink(entries: SurveyEntry[], branding: SurveysExportBranding = {}): string {
  const payload: SurveysSharePayload = {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    branding: {
      brokerageName: String(branding.brokerageName || EXPORT_BRAND.name).trim() || EXPORT_BRAND.name,
      clientName: String(branding.clientName || "Client").trim() || "Client",
      reportDate: String(branding.reportDate || formatDateMmDdYyyy(new Date())).trim(),
      preparedBy: String(branding.preparedBy || "").trim(),
    },
    entries,
  };
  const encoded = serializeForShare(payload);
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/surveys/share?data=${encodeURIComponent(encoded)}`;
}

export function parseSurveysShareData(encoded: string | null | undefined): SurveysSharePayload | null {
  const value = String(encoded || "").trim();
  if (!value) return null;
  return deserializeShare(value);
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  const blob = new Blob([arrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

