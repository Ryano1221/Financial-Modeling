import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import type {
  ObligationCompany,
  ObligationDocumentKind,
  ObligationPortfolioMetrics,
  ObligationRecord,
  ObligationTimelineBucket,
} from "./types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function annualBaseFromSchedule(canonical: BackendCanonicalLease): number {
  const first = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule[0] : null;
  const rate = asNumber(first?.rent_psf_annual);
  const rsf = Math.max(0, asNumber(canonical.rsf));
  if (rate <= 0 || rsf <= 0) return 0;
  return rsf * rate;
}

function fromIsoDate(value: string): Date | null {
  const raw = asText(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseAmbiguousDateToken(rawToken: string): string {
  const token = asText(rawToken).replace(/,/g, "");
  if (!token) return "";

  let m = token.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yyyy = Number(m[3]);
    if (yyyy < 100) yyyy += yyyy >= 70 ? 1900 : 2000;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 && yyyy <= 2100) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  m = token.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && yyyy >= 1900 && yyyy <= 2100) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function extractFirstDateInText(rawText: string): string {
  const text = asText(rawText);
  if (!text) return "";

  const numericMatches = text.match(/\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2})\b/g) || [];
  for (const token of numericMatches) {
    const normalized = parseAmbiguousDateToken(token);
    if (normalized) return normalized;
  }

  const longMatches = text.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{2,4}\b/gi) || [];
  for (const token of longMatches) {
    const normalized = parseAmbiguousDateToken(token);
    if (normalized) return normalized;
  }

  return "";
}

function extractDateFromUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return extractFirstDateInText(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = extractDateFromUnknown(entry);
      if (normalized) return normalized;
    }
    return "";
  }

  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const normalized = extractDateFromUnknown(entry);
      if (normalized) return normalized;
    }
  }

  return "";
}

function extractKeywordDate(notes: string, keywords: string[]): string {
  if (!notes) return "";
  const lower = notes.toLowerCase();
  for (const keyword of keywords) {
    const idx = lower.indexOf(keyword);
    if (idx < 0) continue;
    const tail = notes.slice(idx, idx + 100);
    const normalized = extractFirstDateInText(tail);
    if (normalized) return normalized;
  }
  return "";
}

export function inferObligationDocumentKind(fileName: string, normalize?: NormalizerResponse): ObligationDocumentKind {
  const byName = asText(fileName).toLowerCase();
  const bySummary = asText(normalize?.extraction_summary?.document_type_detected).toLowerCase();
  const byCanonical = asText(normalize?.canonical_lease?.document_type_detected).toLowerCase();
  const haystack = `${byName} ${bySummary} ${byCanonical}`;

  if (haystack.includes("sublease") || haystack.includes("sub-landlord") || haystack.includes("sub landlord")) return "sublease";
  if (haystack.includes("amend") || haystack.includes("restatement")) return "amendment";
  if (haystack.includes("counterproposal") || haystack.includes("counter proposal") || haystack.includes("counter")) return "counter";
  if (haystack.includes("abstract")) return "abstract";
  if (haystack.includes("survey") || haystack.includes("flyer") || haystack.includes("brochure") || haystack.includes("floorplan")) return "survey";
  if (haystack.includes("analysis") || haystack.includes("comparison") || haystack.includes("deck")) return "analysis";
  if (haystack.includes("proposal") || haystack.includes("loi") || haystack.includes("letter of intent")) return "proposal";
  if (haystack.includes("lease")) return "lease";
  return "other";
}

export function mapNormalizeToObligationSeed(normalize: NormalizerResponse, sourceFileName: string) {
  const canonical = normalize.canonical_lease;
  const canonicalRecord = canonical as Record<string, unknown>;
  const notes = asText(canonical.notes);
  const building = asText(canonical.building_name || canonical.premises_name);
  const suite = asText(canonical.suite || canonical.floor);
  const floor = asText(canonical.floor);
  const address = asText(canonical.address);
  const rsf = Math.max(0, Math.floor(asNumber(canonical.rsf)));
  const leaseType = asText(canonical.lease_type || "Unknown");
  const commencementDate = asText(canonical.commencement_date);
  const expirationDate = asText(canonical.expiration_date);
  const rentCommencementDate = asText(canonical.rent_commencement_date)
    || extractKeywordDate(notes, ["rent commencement", "rental commencement", "commencement"])
    || commencementDate;
  const noticeDate = extractDateFromUnknown(
    canonicalRecord.notice_dates
    ?? canonicalRecord.notice_date
    ?? canonicalRecord.notice_deadline
    ?? canonicalRecord.notice_terms
  ) || extractKeywordDate(notes, ["notice", "notification"]);
  const renewalDate = extractDateFromUnknown(
    canonicalRecord.renewal_options
    ?? canonicalRecord.renewal_option
    ?? canonicalRecord.renewal_rights
    ?? canonicalRecord.options
  ) || extractKeywordDate(notes, ["renewal", "option to renew"]);
  const terminationRightDate = extractDateFromUnknown(
    canonicalRecord.termination_rights
    ?? canonicalRecord.termination_clauses
    ?? canonicalRecord.termination_option
    ?? canonicalRecord.termination_options
  ) || extractKeywordDate(notes, ["termination", "terminate"]);
  const annualObligation = annualBaseFromSchedule(canonical)
    + (Math.max(0, asNumber(canonical.opex_psf_year_1)) * rsf)
    + ((Math.max(0, asNumber(canonical.parking_count)) * Math.max(0, asNumber(canonical.parking_rate_monthly))) * 12);
  const months = Math.max(0, asNumber(canonical.term_months));
  const totalObligation = months > 0 ? (annualObligation * months) / 12 : annualObligation;

  return {
    title: [building || asText(canonical.address), suite ? `Suite ${suite}` : ""].filter(Boolean).join(" ").trim() || sourceFileName,
    buildingName: building,
    address,
    suite,
    floor,
    leaseType,
    rsf,
    commencementDate,
    expirationDate,
    rentCommencementDate,
    noticeDate,
    renewalDate,
    terminationRightDate,
    annualObligation,
    totalObligation,
    notes,
    kind: inferObligationDocumentKind(sourceFileName, normalize),
    confidenceScore: Math.max(0, Math.min(1, asNumber(normalize.confidence_score) || 0)),
    reviewRequired: (normalize.review_tasks?.length || 0) > 0 || (normalize.missing_fields?.length || 0) > 0 || asNumber(normalize.confidence_score) < 0.85,
    parseWarnings: [...(normalize.warnings || []), ...(normalize.missing_fields || []).map((f) => `Missing ${f}`)],
  };
}

function normKey(value: string): string {
  return asText(value).toLowerCase().replace(/\s+/g, " ");
}

export function findMatchingObligation(obligations: ObligationRecord[], companyId: string, seed: ReturnType<typeof mapNormalizeToObligationSeed>): ObligationRecord | null {
  const scope = obligations.filter((item) => item.companyId === companyId);
  if (scope.length === 0) return null;

  const address = normKey(seed.address);
  const building = normKey(seed.buildingName);
  const suite = normKey(seed.suite);

  const exact = scope.find((item) => {
    if (address && normKey(item.address) === address && (!suite || normKey(item.suite) === suite)) return true;
    if (building && normKey(item.buildingName) === building && (!suite || normKey(item.suite) === suite)) return true;
    return false;
  });
  if (exact) return exact;

  if (building) {
    const partial = scope.find((item) => normKey(item.buildingName) === building);
    if (partial) return partial;
  }
  return null;
}

export function computeObligationCompleteness(record: ObligationRecord): number {
  const checks = [
    record.buildingName,
    record.address,
    record.suite || record.floor,
    record.leaseType,
    record.rsf > 0 ? "yes" : "",
    record.commencementDate,
    record.expirationDate,
    record.annualObligation > 0 ? "yes" : "",
  ];
  const score = checks.reduce((acc, value) => (asText(value) ? acc + 1 : acc), 0) / checks.length;
  return Math.round(score * 100);
}

export function toIsoDate(dateValue: Date): string {
  const yyyy = dateValue.getUTCFullYear();
  const mm = String(dateValue.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateValue.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function createDefaultCompany(name = "Default Portfolio"): ObligationCompany {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAtIso: new Date().toISOString(),
  };
}

export function computePortfolioMetrics(
  obligations: ObligationRecord[],
  documentsCount: number,
  today = new Date(),
): ObligationPortfolioMetrics {
  const oneYearAhead = new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate()));
  const sixMonthsAhead = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, today.getUTCDate()));

  let totalRsf = 0;
  let totalAnnual = 0;
  let expiringWithin12Months = 0;
  let upcomingNoticeWithin6Months = 0;
  let upcomingRenewalWithin12Months = 0;
  let upcomingTerminationWithin12Months = 0;
  let completenessTotal = 0;

  for (const item of obligations) {
    totalRsf += Math.max(0, asNumber(item.rsf));
    totalAnnual += Math.max(0, asNumber(item.annualObligation));
    completenessTotal += Math.max(0, Math.min(100, asNumber(item.completenessScore)));

    const expiry = fromIsoDate(item.expirationDate);
    if (expiry && expiry >= today && expiry <= oneYearAhead) expiringWithin12Months += 1;

    const notice = fromIsoDate(item.noticeDate);
    if (notice && notice >= today && notice <= sixMonthsAhead) upcomingNoticeWithin6Months += 1;

    const renewal = fromIsoDate(item.renewalDate);
    if (renewal && renewal >= today && renewal <= oneYearAhead) upcomingRenewalWithin12Months += 1;

    const termination = fromIsoDate(item.terminationRightDate);
    if (termination && termination >= today && termination <= oneYearAhead) upcomingTerminationWithin12Months += 1;
  }

  return {
    obligationCount: obligations.length,
    documentCount: documentsCount,
    totalRsf,
    totalAnnualObligation: totalAnnual,
    expiringWithin12Months,
    upcomingNoticeWithin6Months,
    upcomingRenewalWithin12Months,
    upcomingTerminationWithin12Months,
    averageCompleteness: obligations.length > 0 ? Math.round(completenessTotal / obligations.length) : 0,
  };
}

export function buildTimelineBuckets(obligations: ObligationRecord[], currentYear = new Date().getUTCFullYear()): ObligationTimelineBucket[] {
  const minimumEndYear = currentYear + 5;
  const maximumYears = 20;

  let maxEventYear = minimumEndYear;
  for (const item of obligations) {
    for (const dt of [fromIsoDate(item.expirationDate), fromIsoDate(item.noticeDate), fromIsoDate(item.renewalDate), fromIsoDate(item.terminationRightDate)]) {
      if (!dt) continue;
      maxEventYear = Math.max(maxEventYear, dt.getUTCFullYear());
    }
  }

  const cappedEndYear = Math.min(maxEventYear, currentYear + maximumYears - 1);
  const years = Array.from({ length: cappedEndYear - currentYear + 1 }, (_, idx) => currentYear + idx);
  return years.map((year) => {
    let expiringCount = 0;
    let noticeCount = 0;
    let renewalCount = 0;
    let terminationCount = 0;
    for (const item of obligations) {
      const expiry = fromIsoDate(item.expirationDate);
      if (expiry && expiry.getUTCFullYear() === year) expiringCount += 1;
      const notice = fromIsoDate(item.noticeDate);
      if (notice && notice.getUTCFullYear() === year) noticeCount += 1;
      const renewal = fromIsoDate(item.renewalDate);
      if (renewal && renewal.getUTCFullYear() === year) renewalCount += 1;
      const termination = fromIsoDate(item.terminationRightDate);
      if (termination && termination.getUTCFullYear() === year) terminationCount += 1;
    }
    return { year, expiringCount, noticeCount, renewalCount, terminationCount };
  });
}
