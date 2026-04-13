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

interface ResolvedCompletedLeaseBranding {
  brokerageName: string;
  clientName: string;
  reportDate: string;
  preparedBy: string;
  brokerageLogoDataUrl: string;
  clientLogoDataUrl: string;
}

function toDateLabel(value: string): string {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || "-";
  return `${m[2]}.${m[3]}.${m[1]}`;
}

function toCurrency(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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

function asDisplayText(value: unknown, fallback = "-"): string {
  const text = asText(value);
  return text || fallback;
}

function valueOrNa(value: unknown): string {
  const text = asText(value);
  return text || "N/A";
}

function formatTemplateDate(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || "N/A";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function formatTemplateCurrency(value: number, decimals = 2): string {
  if (!Number.isFinite(value) || value <= 0) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatTemplateNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value) || value <= 0) return "N/A";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTemplateRatePerSf(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "N/A";
  return `${formatTemplateCurrency(value)}/RSF`;
}

function formatTemplateMonthlyRent(canonical: BackendCanonicalLease): string {
  const firstStep = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule[0] : null;
  const annualRate = toNumber(firstStep?.rent_psf_annual);
  const rsf = toNumber(canonical.rsf);
  if (annualRate <= 0 || rsf <= 0) return "N/A";
  return formatTemplateCurrency((annualRate * rsf) / 12, 0);
}

function schedulePeriodLabel(startMonth: number, endMonth: number): string {
  const start = Math.max(0, Math.floor(startMonth)) + 1;
  const end = Math.max(start, Math.floor(endMonth) + 1);
  return `Months ${start}-${end}`;
}

function splitCloseoutNoteFragments(raw: string): string[] {
  const text = String(raw || "").replace(/\r/g, "\n").replace(/\u2022/g, "\n").trim();
  if (!text) return [];
  return text
    .split(/\s*\|\s*|\n+|;\s+|(?<=[.])\s+(?=[A-Z])/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
}

function findMatchingNotes(raw: string, regex: RegExp, maxItems = 3): string[] {
  const matches = splitCloseoutNoteFragments(raw).filter((fragment) => regex.test(fragment));
  return dedupeStrings(matches).slice(0, maxItems);
}

function joinMatches(values: string[], fallback = "N/A"): string {
  const cleaned = dedupeStrings(values.map((value) => valueOrNa(value)).filter((value) => value !== "N/A"));
  return cleaned.length > 0 ? cleaned.join(" | ") : fallback;
}

function summarizeConcessions(canonical: BackendCanonicalLease, notes: string): string {
  const parts: string[] = [];
  const freeRentMonths = toNumber(canonical.free_rent_months);
  if (freeRentMonths > 0) {
    parts.push(`${freeRentMonths} month${freeRentMonths === 1 ? "" : "s"} free rent`);
  }
  parts.push(
    ...findMatchingNotes(
      notes,
      /\bmoving allowance\b|\brelocation allowance\b|\btenant improvement allowance\b|\bconcession\b|\babatement\b|\bparking abatement\b/i,
      4,
    ),
  );
  return joinMatches(parts);
}

function summarizeParking(canonical: BackendCanonicalLease, notes: string): string {
  const parts: string[] = [];
  const count = toNumber(canonical.parking_count);
  if (count > 0) parts.push(`${formatTemplateNumber(count)} spaces`);
  parts.push(...findMatchingNotes(notes, /\bparking\b|\breserved\b|\bunreserved\b|\b\/1,?000\b|\bpermit\b/i, 3));
  return joinMatches(parts);
}

function summarizeParkingCharges(canonical: BackendCanonicalLease, notes: string): string {
  const parts: string[] = [];
  const monthly = toNumber(canonical.parking_rate_monthly);
  if (monthly > 0) {
    const taxPct = toNumber(canonical.parking_sales_tax_rate);
    parts.push(
      `${formatTemplateCurrency(monthly, 2)} / space / month${taxPct > 0 ? ` + ${(taxPct * 100).toFixed(2)}% tax` : ""}`,
    );
  }
  parts.push(...findMatchingNotes(notes, /\bparking charge\b|\bparking fee\b|\bmonthly parking\b/i, 2));
  return joinMatches(parts);
}

function summarizeOperatingExpenses(canonical: BackendCanonicalLease): string {
  const parts: string[] = [];
  const structure = valueOrNa(canonical.expense_structure_type);
  if (structure !== "N/A") parts.push(structure);
  const opex = toNumber(canonical.opex_psf_year_1);
  if (opex > 0) parts.push(`${formatTemplateCurrency(opex)}/RSF/YR`);
  const stop = toNumber(canonical.expense_stop_psf);
  if (stop > 0) parts.push(`expense stop ${formatTemplateCurrency(stop)}/RSF`);
  return joinMatches(parts);
}

function summarizeImprovementAllowance(canonical: BackendCanonicalLease): string {
  const psf = toNumber(canonical.ti_allowance_psf);
  const total = toNumber(canonical.ti_budget_total);
  const parts: string[] = [];
  if (psf > 0) parts.push(`${formatTemplateCurrency(psf)}/RSF`);
  if (total > 0) parts.push(`${formatTemplateCurrency(total, 0)} total`);
  return joinMatches(parts);
}

function summarizeSecurityDeposit(canonical: BackendCanonicalLease): string {
  const depositText = asText(canonical.security_deposit);
  const depositMonths = toNumber(canonical.security_deposit_months);
  const parts: string[] = [];
  if (depositText) parts.push(depositText);
  if (depositMonths > 0) parts.push(`${depositMonths} month${depositMonths === 1 ? "" : "s"} rent`);
  return joinMatches(parts);
}

function summarizeAbatedRent(canonical: BackendCanonicalLease): string {
  const months = toNumber(canonical.free_rent_months);
  if (months <= 0) return "N/A";
  const scope = canonical.free_rent_scope === "gross" ? "Gross" : "Net";
  return `${scope} | ${months} month${months === 1 ? "" : "s"}`;
}

function summarizeRenewal(canonical: BackendCanonicalLease, notes: string): string {
  return joinMatches([
    asText(canonical.renewal_options),
    asText(canonical.notice_dates),
    ...findMatchingNotes(notes, /\brenew\b|\bextension\b/i, 3),
  ]);
}

function summarizeRofo(canonical: BackendCanonicalLease, notes: string): string {
  return joinMatches([
    ...findMatchingNotes(`${canonical.options || ""}\n${notes}`, /\brofo\b|right of first offer|\bexpansion\b/i, 3),
  ]);
}

function summarizeRofr(canonical: BackendCanonicalLease, notes: string): string {
  return joinMatches([
    ...findMatchingNotes(`${canonical.options || ""}\n${notes}`, /\brofr\b|right of first refusal/i, 3),
  ]);
}

function summarizeTermination(canonical: BackendCanonicalLease, notes: string): string {
  return joinMatches([
    asText(canonical.termination_rights),
    ...findMatchingNotes(`${canonical.options || ""}\n${notes}`, /\btermination\b|\bearly termination\b/i, 3),
  ]);
}

function summarizeAssignment(canonical: BackendCanonicalLease, notes: string): string {
  return joinMatches([
    ...findMatchingNotes(`${canonical.options || ""}\n${notes}`, /\bassign\b|\bassignment\b|\bsublease\b|\bsublet\b/i, 4),
  ]);
}

function summarizeSignage(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\bsignage\b|\bsign\b/i, 3));
}

function summarizeFurniture(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\bfurniture\b|\bfurnished\b/i, 3));
}

function summarizeHoldover(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\bholdover\b/i, 3));
}

function summarizeHvac(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\bhvac\b|\bafter hour\b|\bafter-hour\b/i, 3));
}

function summarizeLateCharges(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\blate charge\b|\blate fee\b|\binterest on late\b/i, 3));
}

function summarizeExpenseCaps(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\bcontrollable\b|\bmanagement fee\b|\bexpense cap\b|\bcap\b/i, 3));
}

function summarizeExpenseExclusions(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\boperating expense\b|\bopex\b|\bexcluded\b|\bexclusion\b|\baudit\b|\bbase year\b|\bexpense stop\b/i, 4));
}

function summarizeOtherTenantExpenses(notes: string): string {
  return joinMatches(findMatchingNotes(notes, /\belectric\b|\bjanitorial\b|\butilities\b|\bwater\b|\bsewer\b|\bgas\b|\btrash\b/i, 4));
}

function formatCloseoutNotes(raw: string): string {
  const fragments = dedupeStrings(splitCloseoutNoteFragments(raw));
  if (fragments.length === 0) return "N/A";
  return fragments.slice(0, 8).map((fragment) => `• ${fragment}`).join("\n");
}

function amendmentOrdinal(index: number): string {
  return ["First", "Second", "Third", "Fourth", "Fifth"][index] || `Amendment ${index + 1}`;
}

function summarizeAmendmentTerms(doc: CompletedLeaseDocumentRecord): string {
  const canonical = doc.canonical;
  const parts: string[] = [];
  if (Array.isArray(canonical.rent_schedule) && canonical.rent_schedule.length > 0) parts.push("rent schedule updated");
  if (toNumber(canonical.free_rent_months) > 0) parts.push("free rent updated");
  if (toNumber(canonical.ti_allowance_psf) > 0 || toNumber(canonical.ti_budget_total) > 0) parts.push("TI package updated");
  if (asText(canonical.expiration_date)) parts.push(`expiration ${formatTemplateDate(canonical.expiration_date)}`);
  if (asText(canonical.renewal_options)) parts.push("renewal options updated");
  if (asText(canonical.termination_rights)) parts.push("termination rights updated");
  if (toNumber(canonical.parking_count) > 0 || toNumber(canonical.parking_rate_monthly) > 0) parts.push("parking updated");
  const noteMatches = findMatchingNotes(asText(canonical.notes), /\brenew\b|\btermination\b|\bassign\b|\bsublease\b|\bparking\b|\bti\b|\ballowance\b/i, 2);
  return joinMatches([...parts, ...noteMatches]);
}

function safeImageExtension(dataUrl: string): "png" | "jpeg" | "gif" | null {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/);
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw === "png") return "png";
  if (raw === "jpg" || raw === "jpeg") return "jpeg";
  if (raw === "gif") return "gif";
  return null;
}

async function svgDataUrlToPngDataUrl(dataUrl: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width || 400;
      canvas.height = img.height || 160;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function normalizeLogoForExcel(
  dataUrl: string | null | undefined,
): Promise<{ base64: string; extension: "png" | "jpeg" | "gif" } | null> {
  const raw = asText(dataUrl);
  if (!raw.startsWith("data:image/")) return null;
  const directExt = safeImageExtension(raw);
  if (directExt) return { base64: raw, extension: directExt };
  if (raw.startsWith("data:image/svg+xml")) {
    const pngDataUrl = await svgDataUrlToPngDataUrl(raw);
    const pngExt = pngDataUrl ? safeImageExtension(pngDataUrl) : null;
    if (pngDataUrl && pngExt) return { base64: pngDataUrl, extension: pngExt };
  }
  return null;
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
    excelDescriptor: "Lease Abstract",
    pdfDescriptor: "Lease Abstract Presentation",
  });
}

function resolveCompletedLeaseBranding(branding: CompletedLeaseExportBranding = {}): ResolvedCompletedLeaseBranding {
  const resolved = resolveExportBranding(branding);
  return {
    ...resolved,
    brokerageLogoDataUrl: String(branding.brokerageLogoDataUrl || "").trim(),
    clientLogoDataUrl: String(branding.clientLogoDataUrl || "").trim(),
  };
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
  branding: ResolvedCompletedLeaseBranding,
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

async function addBrandedHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  totalCols: number,
  branding: ResolvedCompletedLeaseBranding,
): Promise<number> {
  const rowAfterBand = styleHeaderBand(sheet, title, subtitle, totalCols);
  const brokerageLogo = await normalizeLogoForExcel(branding.brokerageLogoDataUrl);
  if (brokerageLogo) {
    const imageId = workbook.addImage(brokerageLogo);
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.15 },
      ext: { width: 112, height: 28 },
      editAs: "oneCell",
    });
  }
  const clientLogo = await normalizeLogoForExcel(branding.clientLogoDataUrl);
  if (clientLogo) {
    const imageId = workbook.addImage(clientLogo);
    sheet.addImage(imageId, {
      tl: { col: Math.max(1.2, totalCols - 1.7), row: 0.15 },
      ext: { width: 102, height: 28 },
      editAs: "oneCell",
    });
  }
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

function buildClauseSummaryRows(canonical: BackendCanonicalLease, notes: string): Array<[string, string]> {
  return [
    ["Concessions", summarizeConcessions(canonical, notes)],
    ["Improvement Allowance", summarizeImprovementAllowance(canonical)],
    ["Operating Expenses", summarizeOperatingExpenses(canonical)],
    ["Parking", summarizeParking(canonical, notes)],
    ["Parking Charges", summarizeParkingCharges(canonical, notes)],
    ["Security Deposit", summarizeSecurityDeposit(canonical)],
    ["Renewal", summarizeRenewal(canonical, notes)],
    ["ROFR", summarizeRofr(canonical, notes)],
    ["ROFO / Expansion", summarizeRofo(canonical, notes)],
    ["Early Termination", summarizeTermination(canonical, notes)],
    ["Assignment / Sublease", summarizeAssignment(canonical, notes)],
    ["Signage", summarizeSignage(notes)],
    ["Furniture", summarizeFurniture(notes)],
    ["Holdover", summarizeHoldover(notes)],
    ["HVAC / After Hours", summarizeHvac(notes)],
    ["Notes", formatCloseoutNotes(notes)],
  ];
}

function buildAbstractSections(canonical: BackendCanonicalLease): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  const rowMap = new Map(abstractRows(canonical).map((row) => [row.label, row.value]));
  const pick = (label: string) => ({ label, value: rowMap.get(label) || "-" });
  return [
    {
      title: "Parties and Premises",
      rows: [
        pick("Tenant"),
        pick("Landlord"),
        pick("Premises"),
        pick("Building"),
        pick("Address"),
        pick("Suite / Floor"),
        pick("RSF"),
        pick("Lease Type"),
      ],
    },
    {
      title: "Dates and Term",
      rows: [
        pick("Commencement"),
        pick("Rent Commencement"),
        pick("Expiration"),
        pick("Term (Months)"),
        pick("Discount Rate"),
      ],
    },
    {
      title: "Economics",
      rows: [
        pick("Base Rent ($/SF/YR)"),
        pick("Base Rent Schedule"),
        pick("Annual Base Rent Escalation"),
        pick("Free Rent (Months)"),
        pick("OpEx Structure"),
        pick("Base OpEx ($/SF/YR)"),
        pick("OpEx Escalation"),
        pick("Parking Spaces"),
        pick("Parking Rate (Monthly)"),
        pick("TI Allowance ($/SF)"),
      ],
    },
    {
      title: "Options and Protections",
      rows: [
        pick("Deposit"),
        pick("Guaranty"),
        pick("Options"),
        pick("Notice Dates"),
        pick("Notes"),
      ],
    },
  ];
}

async function writeSummarySheet(
  workbook: ExcelJS.Workbook,
  abstract: CompletedLeaseAbstractView,
  branding: ResolvedCompletedLeaseBranding,
): Promise<void> {
  const canonical = abstract.controllingCanonical;
  const notes = [asText(canonical.notes), asText(canonical.options), asText(canonical.notice_dates)].filter(Boolean).join("\n");
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
  let row = await addBrandedHeader(
    workbook,
    sheet,
    "Lease Abstract Presentation",
    "Client-ready summary of controlling lease terms, economics, and amendment impact",
    totalCols,
    branding,
  );

  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Executive Snapshot";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const kpis: Array<[string, string, string, string]> = [
    ["Tenant", asDisplayText(canonical.tenant_name), "Premises", asDisplayText(canonical.premises_name || canonical.building_name)],
    ["RSF", formatTemplateNumber(toNumber(canonical.rsf), 0), "Term", `${toNumber(canonical.term_months) || monthDiffInclusive(canonical.commencement_date, canonical.expiration_date)} months`],
    ["Commencement", formatTemplateDate(canonical.commencement_date), "Expiration", formatTemplateDate(canonical.expiration_date)],
    ["Year 1 Base Rent", formatTemplateRatePerSf(getBaseRentYearOne(canonical)), "Escalation", getEscalationPct(canonical) > 0 ? `${(getEscalationPct(canonical) * 100).toFixed(2)}%` : "N/A"],
    ["Monthly Base Rent", formatTemplateMonthlyRent(canonical), "Operating Expenses", summarizeOperatingExpenses(canonical)],
    ["TI Package", summarizeImprovementAllowance(canonical), "Parking", summarizeParking(canonical, notes)],
  ];

  kpis.forEach(([leftLabel, leftValue, rightLabel, rightValue]) => {
    sheet.getCell(row, 1).value = leftLabel;
    sheet.getCell(row, 2).value = leftValue;
    sheet.getCell(row, 3).value = rightLabel;
    sheet.mergeCells(row, 4, row, 6);
    sheet.getCell(row, 4).value = rightValue;
    sheet.getCell(row, 2).font = { name: EXCEL_THEME.font.family, bold: true, size: 11, color: { argb: COLORS.text } };
    sheet.getCell(row, 4).font = { name: EXCEL_THEME.font.family, bold: true, size: 11, color: { argb: COLORS.text } };
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  });

  row += 1;
  sheet.mergeCells(row, 1, row, totalCols);
  sheet.getCell(row, 1).value = "Key Clauses";
  styleTableHeader(sheet, row, 1, totalCols);
  row += 1;

  const clauseRows = buildClauseSummaryRows(canonical, notes);
  clauseRows.forEach(([label, value]) => {
    sheet.getCell(row, 1).value = label;
    sheet.mergeCells(row, 2, row, totalCols);
    sheet.getCell(row, 2).value = value;
    sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: row,
    lastCol: totalCols,
    fitToHeight: 1,
  });
}

async function writeAbstractSheet(
  workbook: ExcelJS.Workbook,
  abstract: CompletedLeaseAbstractView,
  branding: ResolvedCompletedLeaseBranding,
): Promise<void> {
  const canonical = abstract.controllingCanonical;
  const sheet = workbook.addWorksheet("Lease Abstract", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 28 },
    { width: 34 },
    { width: 24 },
    { width: 24 },
  ];
  const totalCols = 4;
  let row = await addBrandedHeader(
    workbook,
    sheet,
    "Lease Abstract",
    "Controlling terms grouped for client delivery and internal verification",
    totalCols,
    branding,
  );

  buildAbstractSections(canonical).forEach((section) => {
    sheet.mergeCells(row, 1, row, totalCols);
    sheet.getCell(row, 1).value = section.title;
    styleTableHeader(sheet, row, 1, totalCols);
    row += 1;

    section.rows.forEach((item) => {
      sheet.getCell(row, 1).value = item.label;
      sheet.getCell(row, 2).value = item.value;
      sheet.getCell(row, 3).value = "";
      sheet.getCell(row, 4).value = "";
      sheet.mergeCells(row, 2, row, 4);
      sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    });

    row += 1;
  });

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: row,
    lastCol: totalCols,
  });
}

async function writeRentScheduleSheet(
  workbook: ExcelJS.Workbook,
  abstract: CompletedLeaseAbstractView,
  branding: ResolvedCompletedLeaseBranding,
): Promise<void> {
  const canonical = abstract.controllingCanonical;
  const sheet = workbook.addWorksheet("Rent Schedule", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  sheet.columns = [
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 20 },
    { width: 22 },
    { width: 28 },
  ];
  const totalCols = 6;
  let row = await addBrandedHeader(
    workbook,
    sheet,
    "Rent Schedule",
    "Controlling base rent schedule translated into monthly and annual outputs",
    totalCols,
    branding,
  );

  const headers = ["Period", "Start Month", "End Month", "Annual Rate / SF", "Monthly Base Rent", "Commentary"];
  headers.forEach((header, idx) => {
    sheet.getCell(row, idx + 1).value = header;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  const rsf = toNumber(canonical.rsf);
  const steps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [];
  if (steps.length === 0) {
    sheet.mergeCells(row, 1, row + 1, totalCols);
    const cell = sheet.getCell(row, 1);
    cell.value = "No rent schedule is available on the controlling abstract.";
    cell.font = { name: EXCEL_THEME.font.family, size: 12, bold: true, color: { argb: COLORS.text } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    styleTableBodyRow(sheet, row, 1, totalCols, false);
    row += 2;
  } else {
    steps.forEach((step) => {
      const annualRate = toNumber(step.rent_psf_annual);
      const monthlyRent = annualRate > 0 && rsf > 0 ? (annualRate * rsf) / 12 : 0;
      sheet.getCell(row, 1).value = schedulePeriodLabel(toNumber(step.start_month), toNumber(step.end_month));
      sheet.getCell(row, 2).value = toNumber(step.start_month) + 1;
      sheet.getCell(row, 3).value = toNumber(step.end_month) + 1;
      sheet.getCell(row, 4).value = annualRate;
      sheet.getCell(row, 5).value = monthlyRent;
      sheet.getCell(row, 6).value = annualRate > 0 ? `${formatTemplateCurrency(annualRate)} / RSF / YR` : "Rate unavailable";
      sheet.getCell(row, 2).numFmt = NUM_FMT.integer;
      sheet.getCell(row, 3).numFmt = NUM_FMT.integer;
      sheet.getCell(row, 4).numFmt = NUM_FMT.currency2;
      sheet.getCell(row, 5).numFmt = NUM_FMT.currency0;
      for (let c = 1; c <= totalCols; c += 1) {
        sheet.getCell(row, c).alignment = { horizontal: c >= 2 && c <= 5 ? "right" : "left", vertical: "middle", wrapText: true };
      }
      styleTableBodyRow(sheet, row, 1, totalCols, row % 2 === 0);
      row += 1;
    });
  }

  applyExcelPageSetup(sheet, {
    landscape: false,
    lastRow: Math.max(row, headerRow + 2),
    lastCol: totalCols,
    repeatHeaderRow: headerRow,
    fitToHeight: 1,
  });
}

async function writeSourceDocumentsSheet(
  workbook: ExcelJS.Workbook,
  abstract: CompletedLeaseAbstractView,
  branding: ResolvedCompletedLeaseBranding,
): Promise<void> {
  const sheet = workbook.addWorksheet("Source Documents", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
  sheet.columns = [
    { width: 14 },
    { width: 34 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 32 },
  ];
  const totalCols = 6;
  let row = await addBrandedHeader(
    workbook,
    sheet,
    "Source Documents",
    "Document stack used to build the controlling abstract and amendment precedence",
    totalCols,
    branding,
  );

  const headers = ["Type", "Document", "Uploaded", "Role", "Detected Type", "Warnings"];
  headers.forEach((header, idx) => {
    sheet.getCell(row, idx + 1).value = header;
  });
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  abstract.sourceDocuments.forEach((doc) => {
    sheet.getCell(row, 1).value = doc.kind === "amendment" ? "Amendment" : "Lease";
    sheet.getCell(row, 2).value = doc.fileName;
    sheet.getCell(row, 3).value = toDateLabel(doc.uploadedAtIso.slice(0, 10));
    sheet.getCell(row, 4).value = doc.id === abstract.controllingDocumentId ? "Controlling" : "Reference";
    sheet.getCell(row, 5).value = asDisplayText(doc.extractionSummary?.document_type_detected);
    sheet.getCell(row, 6).value = doc.warnings.length > 0 ? doc.warnings.join(" | ") : "None";
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

async function writeAuditSheet(
  workbook: ExcelJS.Workbook,
  abstract: CompletedLeaseAbstractView,
  branding: ResolvedCompletedLeaseBranding,
): Promise<void> {
  const sheet = workbook.addWorksheet("Audit Notes", { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 18 },
    { width: 54 },
  ];
  const totalCols = 2;
  let row = await addBrandedHeader(
    workbook,
    sheet,
    "Audit Notes",
    "Override history and amendment commentary for internal traceability",
    totalCols,
    branding,
  );

  sheet.getCell(row, 1).value = "Source";
  sheet.getCell(row, 2).value = "Audit Note";
  styleTableHeader(sheet, row, 1, totalCols);
  const headerRow = row;
  row += 1;

  const auditRows: Array<[string, string]> = [];
  if (abstract.overrideNotes.length > 0) {
    abstract.overrideNotes.forEach((note) => {
      auditRows.push(["Override", note]);
    });
  }
  abstract.sourceDocuments
    .filter((doc) => doc.kind === "amendment")
    .forEach((doc, index) => {
      auditRows.push([amendmentOrdinal(index), summarizeAmendmentTerms(doc)]);
    });

  if (auditRows.length === 0) {
    auditRows.push(["System", "No amendment override notes were generated for this abstract."]);
  }

  auditRows.forEach(([source, note]) => {
    sheet.getCell(row, 1).value = source;
    sheet.getCell(row, 2).value = note;
    sheet.getCell(row, 1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    sheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
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

export async function buildCompletedLeaseAbstractWorkbook(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const resolvedBranding = resolveCompletedLeaseBranding(branding);
  workbook.creator = resolvedBranding.brokerageName;
  workbook.lastModifiedBy = resolvedBranding.preparedBy;
  workbook.company = resolvedBranding.brokerageName;
  workbook.created = new Date();
  workbook.modified = new Date();

  await writeSummarySheet(workbook, abstract, resolvedBranding);
  await writeAbstractSheet(workbook, abstract, resolvedBranding);
  await writeRentScheduleSheet(workbook, abstract, resolvedBranding);
  await writeSourceDocumentsSheet(workbook, abstract, resolvedBranding);
  await writeAuditSheet(workbook, abstract, resolvedBranding);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

function logoHtml(dataUrl: string, alt: string): string {
  const safe = String(dataUrl || "").trim();
  if (!safe) return "";
  return `<img src="${safe}" alt="${escapeHtml(alt)}" />`;
}

function buildPdfHtml(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): string {
  const resolvedBranding = resolveCompletedLeaseBranding(branding);
  const canonical = abstract.controllingCanonical;
  const notes = [asText(canonical.notes), asText(canonical.options), asText(canonical.notice_dates)].filter(Boolean).join("\n");
  const sections = buildAbstractSections(canonical);
  const clauseRows = buildClauseSummaryRows(canonical, notes)
    .slice(0, 8)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  const scheduleRows = (Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule : [])
    .map((step) => {
      const annualRate = toNumber(step.rent_psf_annual);
      const monthlyRent = annualRate > 0 && toNumber(canonical.rsf) > 0 ? (annualRate * toNumber(canonical.rsf)) / 12 : 0;
      return `<tr>
        <td>${escapeHtml(schedulePeriodLabel(toNumber(step.start_month), toNumber(step.end_month)))}</td>
        <td class="num">${escapeHtml(String(toNumber(step.start_month) + 1))}</td>
        <td class="num">${escapeHtml(String(toNumber(step.end_month) + 1))}</td>
        <td class="num">${escapeHtml(toCurrency(annualRate, 2))}</td>
        <td class="num">${escapeHtml(toCurrency(monthlyRent))}</td>
      </tr>`;
    })
    .join("");

  const sourceRows = abstract.sourceDocuments
    .map((doc) => `<tr>
      <td>${escapeHtml(doc.kind === "amendment" ? "Amendment" : "Lease")}</td>
      <td>${escapeHtml(doc.fileName)}</td>
      <td>${escapeHtml(toDateLabel(doc.uploadedAtIso.slice(0, 10)))}</td>
      <td>${escapeHtml(doc.id === abstract.controllingDocumentId ? "Controlling" : "Reference")}</td>
    </tr>`)
    .join("");

  const auditList = (abstract.overrideNotes.length > 0 ? abstract.overrideNotes : ["No amendment override notes were generated for this abstract."])
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  const sectionTables = sections
    .map((section) => `<article class="detail-card">
      <h2>${escapeHtml(section.title)}</h2>
      <table>
        <tbody>${section.rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</tbody>
      </table>
    </article>`)
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(buildCompletedLeaseAbstractFileName("pdf", branding).replace(/\.pdf$/i, ""))}</title>
      <style>
        @page { size: letter portrait; margin: 0.42in; }
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
          background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 48%, #ffffff 100%);
          padding: 22px;
        }
        .hero-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          min-height: 38px;
        }
        .hero-top img {
          max-height: 30px;
          max-width: 140px;
          object-fit: contain;
        }
        .hero h1 {
          margin: 16px 0 8px;
          font-size: 26px;
          line-height: 1.08;
        }
        .hero p {
          margin: 0;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
          font-size: 12px;
          line-height: 1.6;
        }
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .kpi-card {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          background: rgba(255,255,255,0.88);
          padding: 12px;
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
          font-size: 16px;
          line-height: 1.22;
        }
        .section {
          margin-top: 14px;
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 14px;
        }
        .section h2, .detail-card h2 {
          margin: 0 0 10px;
          font-size: 13px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        th, td {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 6px 7px;
          text-align: left;
          vertical-align: top;
        }
        th {
          width: 38%;
          background: ${EXPORT_BRAND.pdf.colors.panelFill};
        }
        .detail-grid {
          display: grid;
          gap: 12px;
        }
        .detail-card {
          border: 1px solid ${EXPORT_BRAND.pdf.colors.border};
          padding: 12px;
          break-inside: avoid;
        }
        .num {
          text-align: right;
          white-space: nowrap;
        }
        ul {
          margin: 0;
          padding-left: 18px;
          font-size: 11px;
          line-height: 1.6;
          color: ${EXPORT_BRAND.pdf.colors.subtext};
        }
      </style>
    </head>
    <body>
      <section class="page">
        <div class="hero">
          <div class="hero-top">
            <div>${logoHtml(resolvedBranding.brokerageLogoDataUrl, `${resolvedBranding.brokerageName} logo`)}</div>
            <div>${logoHtml(resolvedBranding.clientLogoDataUrl, `${resolvedBranding.clientName} logo`)}</div>
          </div>
          <h1>Lease Abstract Presentation</h1>
          <p>${escapeHtml(buildExportMetaLine(resolvedBranding))}</p>
          <p>Controlling lease terms summarized into a client-ready abstract with source-document context and amendment traceability.</p>
          <div class="kpi-grid">
            <div class="kpi-card"><span>Tenant</span><strong>${escapeHtml(asDisplayText(canonical.tenant_name))}</strong></div>
            <div class="kpi-card"><span>Premises</span><strong>${escapeHtml(asDisplayText(canonical.premises_name || canonical.building_name))}</strong></div>
            <div class="kpi-card"><span>RSF</span><strong>${escapeHtml(formatTemplateNumber(toNumber(canonical.rsf), 0))}</strong></div>
            <div class="kpi-card"><span>Term</span><strong>${escapeHtml(`${toNumber(canonical.term_months) || monthDiffInclusive(canonical.commencement_date, canonical.expiration_date)} months`)}</strong></div>
            <div class="kpi-card"><span>Year 1 Base Rent</span><strong>${escapeHtml(formatTemplateRatePerSf(getBaseRentYearOne(canonical)))}</strong></div>
            <div class="kpi-card"><span>Concessions</span><strong>${escapeHtml(summarizeConcessions(canonical, notes))}</strong></div>
          </div>
        </div>

        <div class="section">
          <h2>Key Clauses</h2>
          <table><tbody>${clauseRows}</tbody></table>
        </div>
      </section>

      <section class="page">
        <div class="detail-grid">${sectionTables}</div>

        <div class="section">
          <h2>Rent Schedule</h2>
          <table>
            <thead>
              <tr><th>Period</th><th>Start</th><th>End</th><th>Annual Rate / SF</th><th>Monthly Base Rent</th></tr>
            </thead>
            <tbody>${scheduleRows || `<tr><td colspan="5">No rent schedule available.</td></tr>`}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Source Documents</h2>
          <table>
            <thead>
              <tr><th>Type</th><th>Document</th><th>Uploaded</th><th>Role</th></tr>
            </thead>
            <tbody>${sourceRows}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Override Audit Notes</h2>
          <ul>${auditList}</ul>
        </div>
      </section>
    </body>
  </html>`;
}

export function printCompletedLeaseAbstract(
  abstract: CompletedLeaseAbstractView,
  branding: CompletedLeaseExportBranding = {},
): void {
  const html = buildPdfHtml(abstract, branding);
  openPrintWindow(html, { width: 1280, height: 960 });
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
