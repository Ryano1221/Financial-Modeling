import type {
  BackendCanonicalLease,
  BackendRentScheduleStep,
  ExtractionReviewTask,
  NormalizerResponse,
  ScenarioInput,
  ScenarioWithId,
} from "@/lib/types";
import type { ClientWorkspaceDocument, DocumentNormalizeSnapshot } from "@/lib/workspace/types";

const SNAPSHOT_REPAIR_WARNING =
  "Applied legacy snapshot OpEx growth repair from the rent escalation schedule.";
const CONFIDENCE_REPAIR_WARNING =
  "Recovered a durable confidence score for a saved lease snapshot so the extractor can auto-add it consistently.";
const REVIEW_TASK_REPAIR_WARNING =
  "Resolved stale extraction review flags from the saved canonical lease terms.";

function cleanText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeDecimalRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function isNnnLikeExpenseStructure(canonical: BackendCanonicalLease): boolean {
  const leaseType = cleanText(canonical.lease_type);
  const expenseType = cleanText(canonical.expense_structure_type);
  if (expenseType === "base_year" || expenseType === "gross_with_stop") return false;
  if (leaseType.includes("gross") || leaseType.includes("full service")) return false;
  return true;
}

export function inferUniformGrowthRateFromRentSchedule(
  rentSchedule: BackendRentScheduleStep[] | undefined | null,
): number | null {
  const steps = (Array.isArray(rentSchedule) ? rentSchedule : [])
    .map((step) => ({
      start: Math.max(0, Math.floor(Number(step.start_month) || 0)),
      end: Math.max(0, Math.floor(Number(step.end_month) || 0)),
      rate: Number(step.rent_psf_annual) || 0,
    }))
    .filter((step) => step.end >= step.start && step.rate > 0)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const yearlySteps = steps.filter((step) => step.end - step.start + 1 >= 10);
  if (yearlySteps.length < 3) return null;

  const growths: number[] = [];
  for (let index = 1; index < yearlySteps.length; index += 1) {
    const previous = yearlySteps[index - 1];
    const current = yearlySteps[index];
    if (current.start > previous.end + 1 || previous.rate <= 0) continue;
    const growth = current.rate / previous.rate - 1;
    if (growth < 0.01 || growth > 0.06) continue;
    growths.push(growth);
  }

  if (growths.length < 2) return null;
  const minGrowth = Math.min(...growths);
  const maxGrowth = Math.max(...growths);
  if (maxGrowth - minGrowth > 0.003) return null;

  const average = growths.reduce((sum, value) => sum + value, 0) / growths.length;
  return Math.round(average * 10000) / 10000;
}

function shouldRepairCanonicalOpexGrowth(canonical: BackendCanonicalLease): boolean {
  if (normalizeDecimalRate(canonical.opex_growth_rate) > 0) return false;
  if ((Number(canonical.opex_psf_year_1) || 0) <= 0) return false;
  if (canonical.opex_by_calendar_year && Object.keys(canonical.opex_by_calendar_year).length > 0) return false;
  if (!isNnnLikeExpenseStructure(canonical)) return false;

  const documentType = cleanText(canonical.document_type_detected);
  if (documentType && !["proposal", "counter_proposal", "renewal", "counter", "loi"].includes(documentType)) {
    return false;
  }

  return inferUniformGrowthRateFromRentSchedule(canonical.rent_schedule) !== null;
}

function hasUsableRentSchedule(canonical: BackendCanonicalLease): boolean {
  return Array.isArray(canonical.rent_schedule) && canonical.rent_schedule.length > 0;
}

function hasUsableCanonicalCore(canonical: BackendCanonicalLease): boolean {
  return (
    Number.isFinite(Number(canonical.rsf)) &&
    Number(canonical.rsf) > 0 &&
    Number.isFinite(Number(canonical.term_months)) &&
    Number(canonical.term_months) > 0 &&
    cleanText(canonical.commencement_date).length > 0 &&
    cleanText(canonical.expiration_date).length > 0 &&
    hasUsableRentSchedule(canonical)
  );
}

function hasResolvedField(canonical: BackendCanonicalLease, task: ExtractionReviewTask): boolean {
  const fieldPath = cleanText(task.field_path);
  const issueCode = cleanText(task.issue_code);
  const message = cleanText(task.message);
  const haystack = `${fieldPath} ${issueCode} ${message}`;

  if ((haystack.includes("rsf") || haystack.includes("square feet")) && Number(canonical.rsf) > 0) {
    return true;
  }
  if ((haystack.includes("commencement") || haystack.includes("start date")) && cleanText(canonical.commencement_date)) {
    return true;
  }
  if ((haystack.includes("expiration") || haystack.includes("end date")) && cleanText(canonical.expiration_date)) {
    return true;
  }
  if ((haystack.includes("term") || haystack.includes("months")) && Number(canonical.term_months) > 0) {
    return true;
  }
  if ((haystack.includes("rent schedule") || haystack.includes("rent commencement") || haystack.includes("base rent") || fieldPath === "rent_schedule") && hasUsableRentSchedule(canonical)) {
    return true;
  }
  if ((haystack.includes("ti") || haystack.includes("tenant improvement") || haystack.includes("allowance")) && Number.isFinite(Number(canonical.ti_allowance_psf ?? 0))) {
    return true;
  }
  if ((haystack.includes("parking") || haystack.includes("monthly per space")) && (
    Number(canonical.parking_count ?? 0) > 0 ||
    Number(canonical.parking_rate_monthly ?? 0) >= 0
  )) {
    return true;
  }
  if ((haystack.includes("opex") || haystack.includes("cam") || haystack.includes("expense")) && (
    Number(canonical.opex_psf_year_1 ?? 0) >= 0 ||
    cleanText(canonical.expense_structure_type) ||
    cleanText(canonical.lease_type)
  )) {
    return true;
  }
  if (haystack.includes("document type") && cleanText(canonical.document_type_detected)) {
    return true;
  }
  return false;
}

function shouldDropResolvedReviewTask(canonical: BackendCanonicalLease, task: ExtractionReviewTask): boolean {
  const severity = cleanText(task.severity);
  const issueCode = cleanText(task.issue_code);
  const message = cleanText(task.message);
  const fieldPath = cleanText(task.field_path);
  const unresolvedLanguage =
    issueCode.startsWith("missing_") ||
    issueCode.startsWith("unclear_") ||
    issueCode.startsWith("unknown_") ||
    issueCode.includes("_missing") ||
    issueCode.includes("_unclear") ||
    issueCode.includes("_unknown") ||
    issueCode.includes("_incomplete") ||
    message.includes("missing") ||
    message.includes("unclear") ||
    message.includes("unknown") ||
    message.includes("not defined") ||
    message.includes("not explicitly stated") ||
    message.includes("not confidently extracted") ||
    message.includes("provided unclear") ||
    fieldPath.length > 0;

  if (!unresolvedLanguage) return false;
  if (!hasResolvedField(canonical, task)) return false;
  return severity === "warn" || severity === "blocker" || severity === "info";
}

function sanitizeReviewTasks(
  canonical: BackendCanonicalLease,
  reviewTasks: ExtractionReviewTask[] | undefined,
): { reviewTasks: ExtractionReviewTask[]; droppedCount: number } {
  const original = Array.isArray(reviewTasks) ? reviewTasks : [];
  let droppedCount = 0;
  const sanitized = original.filter((task) => {
    if (!task || typeof task !== "object") return false;
    if (!hasUsableCanonicalCore(canonical)) return true;
    if (!shouldDropResolvedReviewTask(canonical, task)) return true;
    droppedCount += 1;
    return false;
  });
  return { reviewTasks: sanitized, droppedCount };
}

function isResolvedMissingField(canonical: BackendCanonicalLease, field: string): boolean {
  const value = cleanText(field);
  if (!value) return false;
  if (value === "rsf") return Number(canonical.rsf) > 0;
  if (value === "commencement_date") return cleanText(canonical.commencement_date).length > 0;
  if (value === "expiration_date") return cleanText(canonical.expiration_date).length > 0;
  if (value === "term_months") return Number(canonical.term_months) > 0;
  if (value === "rent_schedule") return hasUsableRentSchedule(canonical);
  if (value === "ti_allowance_psf") return Number.isFinite(Number(canonical.ti_allowance_psf ?? 0));
  if (value === "parking_count") return Number(canonical.parking_count ?? 0) > 0;
  if (value === "parking_rate_monthly") return Number(canonical.parking_rate_monthly ?? 0) >= 0;
  if (value === "opex_psf_year_1") return Number(canonical.opex_psf_year_1 ?? 0) >= 0;
  return false;
}

function sanitizeMissingFields(
  canonical: BackendCanonicalLease,
  missingFields: string[] | undefined,
): { missingFields: string[]; droppedCount: number } {
  const original = Array.isArray(missingFields) ? missingFields : [];
  let droppedCount = 0;
  const sanitized = original.filter((field) => {
    if (!hasUsableCanonicalCore(canonical)) return true;
    if (!isResolvedMissingField(canonical, String(field))) return true;
    droppedCount += 1;
    return false;
  });
  return { missingFields: sanitized, droppedCount };
}

function inferConfidenceScore(
  canonical: BackendCanonicalLease,
  confidenceScore: unknown,
  fieldConfidence: Record<string, number> | undefined,
): number {
  const explicit = Number(confidenceScore);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(0, Math.min(1, explicit));
  }

  const fieldScores = Object.values(fieldConfidence || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (fieldScores.length > 0) {
    const average = fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length;
    if (hasUsableCanonicalCore(canonical)) {
      return Math.max(0.9, Math.min(1, average));
    }
    return Math.max(0.55, Math.min(1, average));
  }

  if (hasUsableCanonicalCore(canonical)) return 0.92;
  return 0;
}

export function repairDocumentNormalizeSnapshot(
  snapshot: DocumentNormalizeSnapshot | null | undefined,
): DocumentNormalizeSnapshot | undefined {
  if (!snapshot?.canonical_lease) return undefined;
  let nextSnapshot: DocumentNormalizeSnapshot = snapshot;
  const warnings = Array.isArray(snapshot.warnings) ? [...snapshot.warnings] : [];

  if (shouldRepairCanonicalOpexGrowth(snapshot.canonical_lease)) {
    const inferredGrowthRate = inferUniformGrowthRateFromRentSchedule(snapshot.canonical_lease.rent_schedule);
    if (inferredGrowthRate && inferredGrowthRate > 0) {
      nextSnapshot = {
        ...nextSnapshot,
        canonical_lease: {
          ...nextSnapshot.canonical_lease,
          opex_growth_rate: inferredGrowthRate,
        },
      };
      if (!warnings.includes(SNAPSHOT_REPAIR_WARNING)) {
        warnings.push(SNAPSHOT_REPAIR_WARNING);
      }
    }
  }

  const repairedConfidence = inferConfidenceScore(
    nextSnapshot.canonical_lease,
    nextSnapshot.confidence_score,
    nextSnapshot.field_confidence,
  );
  if (repairedConfidence > 0 && repairedConfidence !== Number(nextSnapshot.confidence_score ?? 0)) {
    nextSnapshot = {
      ...nextSnapshot,
      confidence_score: repairedConfidence,
    };
    if (!warnings.includes(CONFIDENCE_REPAIR_WARNING)) {
      warnings.push(CONFIDENCE_REPAIR_WARNING);
    }
  }

  const sanitizedTasks = sanitizeReviewTasks(nextSnapshot.canonical_lease, nextSnapshot.review_tasks);
  if (sanitizedTasks.droppedCount > 0) {
    nextSnapshot = {
      ...nextSnapshot,
      review_tasks: sanitizedTasks.reviewTasks,
    };
    if (!warnings.includes(REVIEW_TASK_REPAIR_WARNING)) {
      warnings.push(REVIEW_TASK_REPAIR_WARNING);
    }
  }

  if (warnings.length > 0) {
    nextSnapshot = {
      ...nextSnapshot,
      warnings,
    };
  }

  return nextSnapshot;
}

export function repairNormalizerResponse(
  response: NormalizerResponse | null | undefined,
): NormalizerResponse | null {
  if (!response?.canonical_lease) return response ?? null;

  const repairedSnapshot = repairDocumentNormalizeSnapshot({
    canonical_lease: response.canonical_lease,
    extraction_summary: response.extraction_summary,
    review_tasks: response.review_tasks || [],
    field_confidence: response.field_confidence || {},
    warnings: response.warnings || [],
    confidence_score: response.confidence_score,
    option_variants: response.option_variants || [],
    canonical_extraction: response.canonical_extraction,
  });
  if (!repairedSnapshot?.canonical_lease) return response;

  const remainingTasks = Array.isArray(repairedSnapshot.review_tasks) ? repairedSnapshot.review_tasks : [];
  const sanitizedMissing = sanitizeMissingFields(repairedSnapshot.canonical_lease, response.missing_fields || []);
  const hasBlockers = remainingTasks.some((task) => cleanText(task?.severity) === "blocker");
  const hasWarns = remainingTasks.some((task) => cleanText(task?.severity) === "warn");
  const overall = inferConfidenceScore(
    repairedSnapshot.canonical_lease,
    repairedSnapshot.confidence_score,
    repairedSnapshot.field_confidence,
  );

  return {
    ...response,
    canonical_lease: repairedSnapshot.canonical_lease,
    extraction_summary: repairedSnapshot.extraction_summary,
    review_tasks: remainingTasks,
    field_confidence: repairedSnapshot.field_confidence || {},
    warnings: repairedSnapshot.warnings || [],
    confidence_score: overall,
    option_variants: repairedSnapshot.option_variants || [],
    canonical_extraction: response.canonical_extraction || repairedSnapshot.canonical_extraction,
    missing_fields: sanitizedMissing.missingFields,
    clarification_questions: sanitizedMissing.missingFields.length === 0 ? [] : response.clarification_questions,
    export_allowed: !hasBlockers,
    extraction_confidence: {
      ...(response.extraction_confidence || {}),
      overall,
      status: hasBlockers ? "red" : (hasWarns ? "yellow" : "green"),
      export_allowed: !hasBlockers,
    },
  };
}

export function normalizerResponseFromSnapshot(
  snapshot: DocumentNormalizeSnapshot | null | undefined,
): NormalizerResponse | null {
  const repaired = repairDocumentNormalizeSnapshot(snapshot);
  if (!repaired?.canonical_lease) return null;
  return repairNormalizerResponse({
    canonical_lease: repaired.canonical_lease,
    option_variants: repaired.option_variants || [],
    confidence_score: Number(repaired.confidence_score || 0),
    field_confidence: repaired.field_confidence || {},
    missing_fields: [],
    clarification_questions: [],
    warnings: repaired.warnings || [],
    extraction_summary: repaired.extraction_summary,
    review_tasks: repaired.review_tasks || [],
    canonical_extraction: repaired.canonical_extraction,
  });
}

function matchingDocumentForScenario(
  scenario: ScenarioInput | ScenarioWithId,
  documents: ClientWorkspaceDocument[],
): ClientWorkspaceDocument | null {
  const sourceDocumentId = cleanText((scenario as { source_document_id?: unknown }).source_document_id);
  const sourceDocumentName = cleanText((scenario as { source_document_name?: unknown }).source_document_name);
  if (!sourceDocumentId && !sourceDocumentName) return null;

  return (
    documents.find((document) => {
      if (sourceDocumentId && cleanText(document.id) === sourceDocumentId) return true;
      if (sourceDocumentName && cleanText(document.name) === sourceDocumentName) return true;
      return false;
    }) || null
  );
}

export function repairScenarioOpexGrowthFromDocuments<T extends ScenarioInput | ScenarioWithId>(
  scenario: T,
  documents: ClientWorkspaceDocument[],
): T {
  const existingGrowth = normalizeDecimalRate((scenario as ScenarioInput).opex_growth);
  if (existingGrowth > 0) return scenario;

  const matchedDocument = matchingDocumentForScenario(scenario, documents);
  if (!matchedDocument?.normalizeSnapshot) return scenario;

  const repairedSnapshot = repairDocumentNormalizeSnapshot(matchedDocument.normalizeSnapshot);
  const inferredGrowth = normalizeDecimalRate(repairedSnapshot?.canonical_lease?.opex_growth_rate);
  if (inferredGrowth <= 0) return scenario;

  return {
    ...scenario,
    opex_growth: inferredGrowth,
  } as T;
}
