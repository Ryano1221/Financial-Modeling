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
const LEASE_CLOSEOUT_TEMPLATE_PATH = "/templates/lease-closeout-template.xlsx";
const LEASE_CLOSEOUT_ADDRESS_SHEET = "ADDRESS";
const LEASE_CLOSEOUT_REFERENCE_SHEET = "Reference Sheet";
const LEASE_CLOSEOUT_MAX_SCHEDULE_ROWS = 14;

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

function setCellValue(sheet: ExcelJS.Worksheet, address: string, value: string | number): void {
  sheet.getCell(address).value = value;
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

function writeLookupPairs(referenceSheet: ExcelJS.Worksheet, pairs: Array<[string, string | number]>): number {
  for (let row = 1; row <= 160; row += 1) {
    referenceSheet.getCell(`A${row}`).value = null;
    referenceSheet.getCell(`B${row}`).value = null;
    referenceSheet.getCell(`C${row}`).value = null;
  }
  let row = 1;
  pairs.forEach(([key, value]) => {
    referenceSheet.getCell(`A${row}`).value = key;
    referenceSheet.getCell(`B${row}`).value = value;
    row += 1;
  });
  return row;
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
    excelDescriptor: "Lease Closeout",
    pdfDescriptor: "Lease Closeout Presentation",
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
  const canonical = abstract.controllingCanonical;
  const notes = [asText(canonical.notes), asText(canonical.options), asText(canonical.notice_dates)].filter(Boolean).join("\n");
  const resolvedBranding = {
    brokerageName: valueOrNa(branding.brokerageName),
    clientName: valueOrNa(branding.clientName),
    reportDate: String(branding.reportDate || new Date().toLocaleDateString("en-US")).trim() || "N/A",
    preparedBy: valueOrNa(branding.preparedBy || branding.brokerageName),
  };
  const templateResponse = await fetch(LEASE_CLOSEOUT_TEMPLATE_PATH, { cache: "no-store" });
  if (!templateResponse.ok) {
    throw new Error("Lease closeout template could not be loaded.");
  }
  const templateBytes = await templateResponse.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBytes as unknown as ExcelJS.Buffer);
  workbook.creator = resolvedBranding.brokerageName;
  workbook.lastModifiedBy = resolvedBranding.preparedBy;
  workbook.company = resolvedBranding.brokerageName;
  workbook.created = new Date();
  workbook.modified = new Date();

  const addressSheet = workbook.getWorksheet(LEASE_CLOSEOUT_ADDRESS_SHEET);
  const referenceSheet = workbook.getWorksheet(LEASE_CLOSEOUT_REFERENCE_SHEET);
  if (!addressSheet || !referenceSheet) {
    throw new Error("Lease closeout template sheets were not found.");
  }

  const lookupPairs: Array<[string, string | number]> = [
    ["Property Name", valueOrNa(canonical.premises_name || canonical.building_name)],
    ["Property Address", valueOrNa(canonical.address)],
    ["Landlord", valueOrNa(canonical.landlord_name)],
    ["Landlord Entity", valueOrNa(canonical.landlord_name)],
    ["Building Square Footage", "N/A"],
    ["Place of Rent Payment", joinMatches(findMatchingNotes(notes, /\bplace of payment\b|\brent payment\b|\bpayable at\b/i, 2))],
    ["Tenant Name", valueOrNa(canonical.tenant_name || branding.clientName)],
    ["Effective Date", "N/A"],
    ["Guarantor", valueOrNa(canonical.guaranty)],
    ["Delivery Date", "N/A"],
    ["Suite Numbers", valueOrNa([canonical.suite, canonical.floor].filter(Boolean).join(" / "))],
    ["Square Footage", formatTemplateNumber(toNumber(canonical.rsf), 0)],
    ["Improvement Allowance", summarizeImprovementAllowance(canonical)],
    ["Expiration", formatTemplateDate(canonical.expiration_date)],
    ["Expiration of Allowance", joinMatches(findMatchingNotes(notes, /\ballowance\b.{0,40}\bexpir/i, 2))],
    ["Term", toNumber(canonical.term_months) > 0 ? `${formatTemplateNumber(toNumber(canonical.term_months), 0)} months` : "N/A"],
    ["Extension Commencement Date", joinMatches(findMatchingNotes(notes, /\bextension commencement\b|\brenewal commencement\b/i, 2))],
    ["Extension Term Length", summarizeRenewal(canonical, notes)],
    ["Security Deposit", summarizeSecurityDeposit(canonical)],
    ["First Month's Rent", formatTemplateMonthlyRent(canonical)],
    ["Abated Rent (Gross or Net)", summarizeAbatedRent(canonical)],
    ["Other Concessions", summarizeConcessions(canonical, notes)],
    ["Moving Allowance", joinMatches(findMatchingNotes(notes, /\bmoving allowance\b|\brelocation allowance\b/i, 2))],
    ["Cap on Controllable", summarizeExpenseCaps(notes)],
    ["2018 Estimate", toNumber(canonical.opex_psf_year_1) > 0 ? `${formatTemplateCurrency(toNumber(canonical.opex_psf_year_1))}/RSF/YR` : "N/A"],
    ["Operating Expense Provisions/Exclusions", summarizeExpenseExclusions(notes)],
    ["Other Expenses Paid By Tenant", summarizeOtherTenantExpenses(notes)],
    ["Operating Expenses", summarizeOperatingExpenses(canonical)],
    ["Parking", summarizeParking(canonical, notes)],
    ["Parking Charges", summarizeParkingCharges(canonical, notes)],
    ["HVAC After Hour Charges and Notice", summarizeHvac(notes)],
    ["Late Charges", summarizeLateCharges(notes)],
    ["Renewal Option (and notice date)", summarizeRenewal(canonical, notes)],
    ["Right of First Refusal", summarizeRofr(canonical, notes)],
    ["ROFO or Expansion Right", summarizeRofo(canonical, notes)],
    ["Early Termination", summarizeTermination(canonical, notes)],
    ["Sublease and Assignment AND Terms of LL Consent", summarizeAssignment(canonical, notes)],
    ["Signage", summarizeSignage(notes)],
    ["Furniture", summarizeFurniture(notes)],
    ["Holdover", summarizeHoldover(notes)],
    ["Notes", formatCloseoutNotes(notes)],
  ];
  let nextReferenceRow = writeLookupPairs(referenceSheet, lookupPairs);
  referenceSheet.getCell(`A${nextReferenceRow}`).value = "Period";
  referenceSheet.getCell(`B${nextReferenceRow}`).value = "Annual Rate Per Square Foot";
  referenceSheet.getCell(`C${nextReferenceRow}`).value = "Monthly Base Rent";
  nextReferenceRow += 1;
  const rsf = toNumber(canonical.rsf);
  const rentSteps = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule.slice(0, LEASE_CLOSEOUT_MAX_SCHEDULE_ROWS) : [];
  rentSteps.forEach((step) => {
    const annualRate = toNumber(step.rent_psf_annual);
    referenceSheet.getCell(`A${nextReferenceRow}`).value = schedulePeriodLabel(
      toNumber(step.start_month),
      toNumber(step.end_month),
    );
    referenceSheet.getCell(`B${nextReferenceRow}`).value = annualRate > 0 ? annualRate : "N/A";
    referenceSheet.getCell(`C${nextReferenceRow}`).value = annualRate > 0 && rsf > 0 ? (annualRate * rsf) / 12 : "N/A";
    nextReferenceRow += 1;
  });

  addressSheet.getCell("A1").value = "Lease Closeout";
  addressSheet.getCell("D4").value = resolvedBranding.brokerageName;
  addressSheet.getCell("D4").font = {
    name: EXCEL_THEME.font.family,
    bold: true,
    size: 14,
    color: { argb: COLORS.text },
  };
  addressSheet.getCell("D4").alignment = { horizontal: "right", vertical: "middle" };
  setCellValue(addressSheet, "D65", resolvedBranding.preparedBy);
  setCellValue(addressSheet, "I65", resolvedBranding.reportDate);
  setCellValue(addressSheet, "C23", summarizeConcessions(canonical, notes));
  setCellValue(addressSheet, "K23", joinMatches(findMatchingNotes(notes, /\bmoving allowance\b|\brelocation allowance\b/i, 2)));

  const amendments = abstract.sourceDocuments.filter((doc) => doc.kind === "amendment").slice(0, 2);
  if (amendments.length === 0) {
    setCellValue(addressSheet, "C25", "None");
    setCellValue(addressSheet, "F25", "N/A");
    setCellValue(addressSheet, "I25", "N/A");
    setCellValue(addressSheet, "C26", "N/A");
    setCellValue(addressSheet, "F26", "N/A");
    setCellValue(addressSheet, "I26", "N/A");
  } else {
    amendments.forEach((doc, index) => {
      const row = 25 + index;
      const label = amendmentOrdinal(index);
      setCellValue(addressSheet, `C${row}`, label);
      setCellValue(addressSheet, `F${row}`, "N/A");
      setCellValue(addressSheet, `H${row}`, `${label} Terms:`);
      setCellValue(addressSheet, `I${row}`, summarizeAmendmentTerms(doc));
    });
    if (amendments.length === 1) {
      setCellValue(addressSheet, "C26", "N/A");
      setCellValue(addressSheet, "F26", "N/A");
      setCellValue(addressSheet, "I26", "N/A");
    }
  }

  const clientLogo = await normalizeLogoForExcel(branding.clientLogoDataUrl || branding.brokerageLogoDataUrl);
  if (clientLogo) {
    const imageId = workbook.addImage(clientLogo);
    addressSheet.getCell("A4").value = "";
    addressSheet.addImage(imageId, {
      tl: { col: 0.1, row: 3.1 },
      ext: { width: 155, height: 70 },
      editAs: "oneCell",
    });
  } else {
    addressSheet.getCell("A4").value = resolvedBranding.clientName;
  }

  const brokerageLogo = await normalizeLogoForExcel(branding.brokerageLogoDataUrl);
  if (brokerageLogo) {
    const imageId = workbook.addImage(brokerageLogo);
    addressSheet.addImage(imageId, {
      tl: { col: 10.2, row: 0.35 },
      ext: { width: 150, height: 42 },
      editAs: "oneCell",
    });
  }

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
