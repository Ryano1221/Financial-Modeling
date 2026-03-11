import ExcelJS from "exceljs";
import {
  EXCEL_THEME,
  EXPORT_BRAND,
  applyExcelPageSetup,
  buildExportMetaLine,
  buildPlatformExportFileName,
} from "@/lib/export-design";
import { downloadArrayBuffer as downloadArrayBufferShared, escapeHtml, openPrintWindow } from "@/lib/export-runtime";
import {
  buildPlatformShareLink,
  parsePlatformShareData,
  type PlatformShareEnvelope,
} from "@/lib/platform-share";
import type { BackendCanonicalLease } from "@/lib/types";
import type {
  CompletedLeaseAbstractView,
  CompletedLeaseDocumentRecord,
  CompletedLeaseExportBranding,
  CompletedLeaseSharePayload,
} from "./types";

const COLORS = EXPORT_BRAND.excel.colors;
const NUM_FMT = EXPORT_BRAND.excel.numberFormats;

export type CompletedLeaseShareEnvelope = PlatformShareEnvelope<CompletedLeaseSharePayload>;

function toDateLabel(value: string): string {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function toCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthDiffInclusive(startIso: string, endIso: string): number {
  const start = String(startIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const end = String(endIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!start || !end) return 0;
  const startMonth = Number(start[1]) * 12 + (Number(start[2]) - 1);
  const endMonth = Number(end[1]) * 12 + (Number(end[2]) - 1);
  return Math.max(0, endMonth - startMonth + 1);
}

function getBaseRentYearOne(canonical: BackendCanonicalLease): number {
  const firstStep = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule[0] : null;
  return toNumber(firstStep?.rent_psf_annual);
}

function getEscalationPct(canonical: BackendCanonicalLease): number {
  const steps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [];
  if (steps.length < 2) return 0;
  const first = toNumber(steps[0]?.rent_psf_annual);
  const second = toNumber(steps[1]?.rent_psf_annual);
  if (first <= 0 || second <= 0) return 0;
  return (second - first) / first;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function rentScheduleSummary(canonical: BackendCanonicalLease): string {
  const steps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [];
  if (steps.length === 0) return "-";
  return steps
    .slice(0, 8)
    .map((step) => {
      const start = Math.max(0, Math.floor(Number(step.start_month) || 0)) + 1;
      const end = Math.max(start, Math.floor(Number(step.end_month) || start - 1) + 1);
      const rate = toNumber(step.rent_psf_annual);
      return `M${start}-${end}: ${rate > 0 ? `$${rate.toFixed(2)}/SF/YR` : "-"}`;
    })
    .join(" | ");
}

function abstractRows(canonical: BackendCanonicalLease): Array<{ label: string; value: string }> {
  const termMonths = toNumber(canonical.term_months) || monthDiffInclusive(canonical.commencement_date, canonical.expiration_date);
  const escalationPct = getEscalationPct(canonical);
  return [
    { label: "Tenant", value: asText(canonical.tenant_name) || "-" },
    { label: "Landlord", value: asText(canonical.landlord_name) || "-" },
    { label: "Premises", value: String(canonical.premises_name || canonical.building_name || "-") },
    { label: "Building", value: String(canonical.building_name || "-") },
    { label: "Address", value: String(canonical.address || "-") },
    { label: "Suite / Floor", value: [canonical.suite, canonical.floor].filter(Boolean).join(" / ") || "-" },
    { label: "RSF", value: toNumber(canonical.rsf).toLocaleString("en-US") || "-" },
    { label: "Lease Type", value: String(canonical.lease_type || "-") },
    { label: "Commencement", value: toDateLabel(String(canonical.commencement_date || "")) },
    { label: "Rent Commencement", value: toDateLabel(String(canonical.rent_commencement_date || "")) },
    { label: "Expiration", value: toDateLabel(String(canonical.expiration_date || "")) },
    { label: "Term (Months)", value: termMonths ? String(termMonths) : "-" },
    { label: "Base Rent ($/SF/YR)", value: getBaseRentYearOne(canonical) ? toCurrency(getBaseRentYearOne(canonical)) : "-" },
    { label: "Base Rent Schedule", value: rentScheduleSummary(canonical) },
    { label: "Annual Base Rent Escalation", value: escalationPct ? `${(escalationPct * 100).toFixed(2)}%` : "-" },
    { label: "Free Rent (Months)", value: String(toNumber(canonical.free_rent_months) || 0) },
    { label: "OpEx Structure", value: asText(canonical.expense_structure_type) || "-" },
    { label: "Base OpEx ($/SF/YR)", value: toNumber(canonical.opex_psf_year_1) ? toCurrency(toNumber(canonical.opex_psf_year_1)) : "-" },
    { label: "OpEx Escalation", value: toNumber(canonical.opex_growth_rate) ? `${(toNumber(canonical.opex_growth_rate) * 100).toFixed(2)}%` : "-" },
    { label: "Parking Spaces", value: String(toNumber(canonical.parking_count) || 0) },
    { label: "Parking Rate (Monthly)", value: toNumber(canonical.parking_rate_monthly) ? toCurrency(toNumber(canonical.parking_rate_monthly)) : "-" },
    { label: "Deposit", value: asText(canonical.security_deposit) || "-" },
    { label: "Guaranty", value: asText(canonical.guaranty) || "-" },
    { label: "Options", value: asText(canonical.options || canonical.renewal_options) || "-" },
    { label: "Notice Dates", value: asText(canonical.notice_dates) || "-" },
    { label: "TI Allowance ($/SF)", value: toNumber(canonical.ti_allowance_psf) ? toCurrency(toNumber(canonical.ti_allowance_psf)) : "-" },
    { label: "Discount Rate", value: `${(toNumber(canonical.discount_rate_annual || 0.08) * 100).toFixed(2)}%` },
    { label: "Notes", value: String(canonical.notes || "-") },
  ];
}

export function buildCompletedLeaseAbstractFileName(
  kind: "xlsx" | "pdf",
  branding: CompletedLeaseExportBranding,
): string {
  return buildPlatformExportFileName({
    kind,
    brokerageName: branding.brokerageName,
    clientName: branding.clientName,
    reportDate: branding.reportDate,
    excelDescriptor: "Completed Lease Abstract",
    pdfDescriptor: "Completed Lease Abstract Presentation",
  });
}

function styleWorkbookHeader(
  sheet: ExcelJS.Worksheet,
  title: string,
  branding: CompletedLeaseExportBranding,
  totalCols: number,
): number {
  sheet.mergeCells(1, 1, 2, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.black } };
  titleCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.subtitleSize, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 20;
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, totalCols);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = buildExportMetaLine(branding);
  metaCell.font = {
    name: EXCEL_THEME.font.family,
    size: EXCEL_THEME.font.labelSize,
    color: { argb: COLORS.secondaryText },
    bold: true,
  };
  metaCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  sheet.getRow(3).height = 18;
  return 5;
}

export async function buildCompletedLeaseAbstractWorkbook(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "The CRE Model";
  workbook.lastModifiedBy = "The CRE Model";
  workbook.created = new Date();
  workbook.modified = new Date();

  const canonical = abstract.controllingCanonical;
  const rows = abstractRows(canonical);

  const summary = workbook.addWorksheet("Lease Abstract");
  summary.properties.defaultColWidth = 18;
  const firstDataRow = styleWorkbookHeader(summary, "Completed Lease Abstract", branding, 4);

  summary.columns = [
    { width: 28 },
    { width: 42 },
    { width: 22 },
    { width: 26 },
  ];

  let row = firstDataRow;
  summary.mergeCells(row, 1, row, 4);
  const sectionCell = summary.getCell(row, 1);
  sectionCell.value = "Controlling Terms";
  sectionCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
  sectionCell.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white }, size: EXCEL_THEME.font.labelSize };
  sectionCell.alignment = { horizontal: "left", vertical: "middle" };
  summary.getRow(row).height = 18;
  row += 1;

  rows.forEach((item, idx) => {
    summary.getCell(row, 1).value = item.label;
    summary.getCell(row, 2).value = item.value;
    summary.mergeCells(row, 2, row, 4);
    for (let col = 1; col <= 4; col += 1) {
      const cell = summary.getCell(row, col);
      cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
      cell.alignment = { horizontal: col === 1 ? "left" : "left", vertical: "middle", wrapText: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : COLORS.mutedFill },
      };
      cell.border = {
        top: { style: "thin", color: { argb: COLORS.border } },
        bottom: { style: "thin", color: { argb: COLORS.border } },
        left: { style: "thin", color: { argb: COLORS.border } },
        right: { style: "thin", color: { argb: COLORS.border } },
      };
    }
    summary.getRow(row).height = 20;
    row += 1;
  });

  row += 1;
  summary.mergeCells(row, 1, row, 4);
  const sourceHeader = summary.getCell(row, 1);
  sourceHeader.value = "Source Documents";
  sourceHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
  sourceHeader.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white }, size: EXCEL_THEME.font.labelSize };
  row += 1;

  abstract.sourceDocuments.forEach((doc) => {
    summary.getCell(row, 1).value = doc.kind === "amendment" ? "Amendment" : "Lease";
    summary.getCell(row, 2).value = doc.fileName;
    summary.getCell(row, 3).value = toDateLabel(doc.uploadedAtIso.slice(0, 10));
    summary.getCell(row, 4).value = doc.id === abstract.controllingDocumentId ? "Controlling" : "Reference";
    for (let col = 1; col <= 4; col += 1) {
      const cell = summary.getCell(row, col);
      cell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
      cell.border = {
        top: { style: "thin", color: { argb: COLORS.border } },
        bottom: { style: "thin", color: { argb: COLORS.border } },
        left: { style: "thin", color: { argb: COLORS.border } },
        right: { style: "thin", color: { argb: COLORS.border } },
      };
    }
    row += 1;
  });

  if (abstract.overrideNotes.length > 0) {
    row += 1;
    summary.mergeCells(row, 1, row, 4);
    const overrideHeader = summary.getCell(row, 1);
    overrideHeader.value = "Override Audit Notes";
    overrideHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
    overrideHeader.font = { name: EXCEL_THEME.font.family, bold: true, color: { argb: COLORS.white }, size: EXCEL_THEME.font.labelSize };
    row += 1;
    abstract.overrideNotes.forEach((note) => {
      summary.mergeCells(row, 1, row, 4);
      const noteCell = summary.getCell(row, 1);
      noteCell.value = `• ${note}`;
      noteCell.font = { name: EXCEL_THEME.font.family, size: EXCEL_THEME.font.bodySize, color: { argb: COLORS.text } };
      noteCell.alignment = { horizontal: "left", vertical: "top", wrapText: true };
      noteCell.border = {
        top: { style: "thin", color: { argb: COLORS.border } },
        bottom: { style: "thin", color: { argb: COLORS.border } },
        left: { style: "thin", color: { argb: COLORS.border } },
        right: { style: "thin", color: { argb: COLORS.border } },
      };
      row += 1;
    });
  }

  applyExcelPageSetup(summary, {
    landscape: false,
    lastRow: Math.max(row, firstDataRow + 6),
    lastCol: 4,
    fitToHeight: 1,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

function buildPdfHtml(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): string {
  const canonical = abstract.controllingCanonical;
  const rows = abstractRows(canonical);
  const metaLine = buildExportMetaLine(branding);

  const tableRows = rows
    .map((item) => `<tr><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.value)}</td></tr>`)
    .join("");

  const sourceRows = abstract.sourceDocuments
    .map(
      (doc) =>
        `<tr><td>${escapeHtml(doc.kind === "amendment" ? "Amendment" : "Lease")}</td><td>${escapeHtml(doc.fileName)}</td><td>${escapeHtml(toDateLabel(doc.uploadedAtIso.slice(0, 10)))}</td><td>${doc.id === abstract.controllingDocumentId ? "Controlling" : "Reference"}</td></tr>`
    )
    .join("");

  const overrides = abstract.overrideNotes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(buildCompletedLeaseAbstractFileName("pdf", branding).replace(/\.pdf$/i, ""))}</title>
      <style>
        @page { size: letter portrait; margin: 0.45in; }
        body {
          margin: 0;
          font-family: ${EXPORT_BRAND.pdf.fonts.family};
          color: ${EXPORT_BRAND.pdf.colors.ink};
          background: white;
        }
        .page {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 20px;
        }
        .title {
          font-size: 30px;
          font-weight: 700;
          margin: 0 0 8px;
        }
        .meta {
          margin: 0 0 18px;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
          font-size: 12px;
        }
        h2 {
          font-size: 15px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 20px 0 10px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th, td {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        th {
          width: 34%;
          background: ${EXPORT_BRAND.pdf.colors.mutedFill};
        }
        .source th, .source td { width: auto; }
        ul {
          margin: 8px 0 0 18px;
          padding: 0;
          font-size: 11px;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
        }
      </style>
    </head>
    <body>
      <section class="page">
        <p class="title">Completed Lease Abstract</p>
        <p class="meta">${escapeHtml(metaLine)}</p>
        <h2>Controlling Terms</h2>
        <table>
          <tbody>${tableRows}</tbody>
        </table>
        <h2>Source Documents</h2>
        <table class="source">
          <thead>
            <tr><th>Type</th><th>Document</th><th>Uploaded</th><th>Status</th></tr>
          </thead>
          <tbody>${sourceRows}</tbody>
        </table>
        ${
          overrides
            ? `<h2>Override Audit Notes</h2><ul>${overrides}</ul>`
            : ""
        }
      </section>
    </body>
  </html>`;
}

export function printCompletedLeaseAbstract(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): void {
  const html = buildPdfHtml(abstract, branding);
  openPrintWindow(html, { width: 1280, height: 900 });
}

export function downloadArrayBuffer(arrayBuffer: ArrayBuffer, fileName: string, mimeType: string): void {
  downloadArrayBufferShared(arrayBuffer, fileName, mimeType);
}

export function buildCompletedLeaseShareLink(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): string {
  const payload: CompletedLeaseSharePayload = {
    title: "Completed Lease Abstract",
    fields: abstractRows(abstract.controllingCanonical).map((row) => ({
      label: row.label,
      value: row.value,
    })),
    sourceDocuments: abstract.sourceDocuments.map((doc) => ({
      kind: doc.kind,
      fileName: doc.fileName,
      uploadedAtIso: doc.uploadedAtIso,
      controllingStatus: doc.id === abstract.controllingDocumentId ? "controlling" : "reference",
    })),
    overrideNotes: [...abstract.overrideNotes],
  };
  return buildPlatformShareLink(
    "/completed-leases/share",
    "completed-leases",
    payload,
    branding,
  );
}

export function parseCompletedLeaseShareData(
  encoded: string | null | undefined,
): CompletedLeaseShareEnvelope | null {
  const parsed = parsePlatformShareData<CompletedLeaseSharePayload>(
    encoded,
    "completed-leases",
  );
  if (!parsed || !Array.isArray(parsed.payload.fields) || !Array.isArray(parsed.payload.sourceDocuments)) return null;
  return parsed;
}
