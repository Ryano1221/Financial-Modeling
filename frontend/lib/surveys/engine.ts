import type { BackendCanonicalLease, NormalizerResponse } from "@/lib/types";
import type { SurveyCostBreakdown, SurveyEntry, SurveyLeaseType, SurveyOccupancyType } from "./types";

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toIsoDate(value: Date): string {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeLeaseType(raw: unknown): SurveyLeaseType {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "Unknown";
  if (value.includes("nnn") || value.includes("triple net") || value.includes("net")) return "NNN";
  if (value.includes("modified gross") || value.includes("mod gross")) return "Modified Gross";
  if (value.includes("base year")) return "Base Year";
  if (value.includes("gross")) return "Gross";
  return "Unknown";
}

function inferOccupancyType(normalize: NormalizerResponse, canonical: BackendCanonicalLease): SurveyOccupancyType {
  const summary = String(normalize.extraction_summary?.document_type_detected || "").toLowerCase();
  const canonicalType = String(canonical.document_type_detected || "").toLowerCase();
  const notes = String(canonical.notes || "").toLowerCase();
  if (summary.includes("sublease") || canonicalType.includes("sublease") || notes.includes("sublease")) return "Sublease";
  if (summary.includes("lease") || canonicalType.includes("lease") || summary.includes("proposal")) return "Direct";
  return "Unknown";
}

function inferSublessor(canonical: BackendCanonicalLease, occupancyType: SurveyOccupancyType): string {
  if (occupancyType !== "Sublease") return "";
  const tenant = valueOrEmpty(canonical.tenant_name);
  const landlord = valueOrEmpty(canonical.landlord_name);
  const notes = valueOrEmpty(canonical.notes);
  if (tenant) return tenant;
  if (landlord) return landlord;
  const match = notes.match(/sublessor[:\s]+([A-Za-z0-9&.,' -]{2,80})/i);
  return match ? valueOrEmpty(match[1]) : "";
}

function firstAnnualRentPsf(canonical: BackendCanonicalLease): number {
  const firstStep = Array.isArray(canonical.rent_schedule) ? canonical.rent_schedule[0] : null;
  const value = Number(firstStep?.rent_psf_annual || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function valueOrEmpty(raw: unknown): string {
  return String(raw || "").trim();
}

function toNumber(raw: unknown, fallback = 0): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapNormalizeToSurveyEntry(
  normalize: NormalizerResponse,
  sourceDocumentName: string,
  clientId = "",
): SurveyEntry {
  const canonical = normalize.canonical_lease;
  const leaseType = normalizeLeaseType(canonical.lease_type);
  const occupancyType = inferOccupancyType(normalize, canonical);
  const inferredSublessor = inferSublessor(canonical, occupancyType);
  const fieldConfidence = normalize.field_confidence || {};
  const reviewTasks = normalize.review_tasks || [];
  const reviewReasons: string[] = [];

  if (!canonical.building_name && !canonical.premises_name) reviewReasons.push("Building name missing.");
  if (!canonical.address) reviewReasons.push("Address missing.");
  if (toNumber(canonical.rsf) <= 0) reviewReasons.push("Available square footage missing.");
  if (firstAnnualRentPsf(canonical) <= 0) reviewReasons.push("Base rent missing.");
  if (leaseType === "Unknown") reviewReasons.push("Lease type ambiguous.");
  if (occupancyType === "Unknown") reviewReasons.push("Direct vs sublease type ambiguous.");
  if (occupancyType === "Sublease" && !inferredSublessor) reviewReasons.push("Sublessor name missing.");
  if ((fieldConfidence.rsf ?? 1) < 0.6) reviewReasons.push("RSF confidence low.");
  if ((fieldConfidence.lease_type ?? 1) < 0.6) reviewReasons.push("Lease type confidence low.");
  if ((fieldConfidence.rent_schedule ?? 1) < 0.6 && (fieldConfidence.base_rent_psf ?? 1) < 0.6) {
    reviewReasons.push("Rent confidence low.");
  }
  if (reviewTasks.length > 0) reviewReasons.push(`${reviewTasks.length} extraction review task(s) detected.`);

  return {
    id: nextId(),
    clientId,
    sourceDocumentName,
    sourceType: "parsed_document",
    uploadedAtIso: new Date().toISOString(),
    buildingName: valueOrEmpty(canonical.building_name || canonical.premises_name),
    address: valueOrEmpty(canonical.address),
    floor: valueOrEmpty(canonical.floor),
    suite: valueOrEmpty(canonical.suite),
    availableSqft: Math.max(0, toNumber(canonical.rsf, 0)),
    baseRentPsfAnnual: firstAnnualRentPsf(canonical),
    opexPsfAnnual: Math.max(0, toNumber(canonical.opex_psf_year_1, 0)),
    leaseType,
    occupancyType,
    sublessor: inferredSublessor,
    subleaseExpirationDate: occupancyType === "Sublease" ? valueOrEmpty(canonical.expiration_date) : "",
    parkingSpaces: Math.max(0, Math.floor(toNumber(canonical.parking_count, 0))),
    parkingRateMonthlyPerSpace: Math.max(0, toNumber(canonical.parking_rate_monthly, 0)),
    notes: valueOrEmpty(canonical.notes),
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    extractionSummary: normalize.extraction_summary,
    reviewTasks,
    fieldConfidence,
    rawCanonical: canonical,
    rawNormalize: normalize,
  };
}

export function createManualSurveyEntryFromImage(fileName: string, clientId = ""): SurveyEntry {
  return {
    id: nextId(),
    clientId,
    sourceDocumentName: fileName,
    sourceType: "manual_image",
    uploadedAtIso: new Date().toISOString(),
    buildingName: "",
    address: "",
    floor: "",
    suite: "",
    availableSqft: 0,
    baseRentPsfAnnual: 0,
    opexPsfAnnual: 0,
    leaseType: "Unknown",
    occupancyType: "Unknown",
    sublessor: "",
    subleaseExpirationDate: "",
    parkingSpaces: 0,
    parkingRateMonthlyPerSpace: 0,
    notes: "",
    needsReview: true,
    reviewReasons: [
      "Image input requires manual review.",
      "Complete all key survey fields before using in client output.",
    ],
    reviewTasks: [],
    fieldConfidence: {},
  };
}

function leaseTypeRule(leaseType: SurveyLeaseType): string {
  if (leaseType === "Gross") return "Gross rent includes operating expenses.";
  if (leaseType === "Modified Gross") return "Modified gross assumes 50% of stated OpEx burden.";
  if (leaseType === "Base Year") return "Base year structure includes full OpEx proxy for comparison.";
  if (leaseType === "NNN") return "NNN includes full OpEx burden.";
  return "Unknown lease type defaults to full OpEx burden.";
}

export function computeSurveyMonthlyOccupancyCost(entry: SurveyEntry): SurveyCostBreakdown {
  const rsf = Math.max(0, Number(entry.availableSqft || 0));
  const annualBase = Math.max(0, Number(entry.baseRentPsfAnnual || 0));
  const annualOpex = Math.max(0, Number(entry.opexPsfAnnual || 0));
  const parkingSpaces = Math.max(0, Math.floor(Number(entry.parkingSpaces || 0)));
  const parkingRate = Math.max(0, Number(entry.parkingRateMonthlyPerSpace || 0));

  const baseRentMonthly = (rsf * annualBase) / 12;
  const rawOpexMonthly = (rsf * annualOpex) / 12;
  const parkingMonthly = parkingSpaces * parkingRate;

  let opexMonthly = rawOpexMonthly;
  if (entry.leaseType === "Gross") {
    opexMonthly = 0;
  } else if (entry.leaseType === "Modified Gross") {
    opexMonthly = rawOpexMonthly * 0.5;
  } else if (entry.leaseType === "Base Year") {
    opexMonthly = rawOpexMonthly;
  } else if (entry.leaseType === "NNN") {
    opexMonthly = rawOpexMonthly;
  }

  const totalMonthly = baseRentMonthly + opexMonthly + parkingMonthly;

  return {
    baseRentMonthly,
    opexMonthly,
    parkingMonthly,
    totalMonthly,
    leaseTypeRule: leaseTypeRule(entry.leaseType),
  };
}
