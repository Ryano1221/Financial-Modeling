import type { BackendCanonicalLease, ExtractionReviewTask, NormalizerResponse } from "@/lib/types";

export const HARD_REVIEW_WARNING_PATTERNS = [
  /automatic extraction failed/i,
  /review template/i,
  /no text could be extracted/i,
  /could not process this file automatically/i,
  /could not confidently parse/i,
  /lease normalization failed/i,
];

const CRITICAL_MISSING_FIELDS = new Set([
  "rsf",
  "rent_schedule",
  "term_months",
  "commencement_date",
  "expiration_date",
]);

export interface NormalizeIntakeDecision {
  parsed: boolean;
  autoAdd: boolean;
  requiresReview: boolean;
  lowConfidence: boolean;
  message: string;
}

export function hasInvalidCanonicalCoreValues(canonical: BackendCanonicalLease): boolean {
  return (
    !canonical ||
    !Number.isFinite(Number(canonical.rsf)) ||
    Number(canonical.rsf) <= 0 ||
    !Number.isFinite(Number(canonical.term_months)) ||
    Number(canonical.term_months) <= 0 ||
    !Array.isArray(canonical.rent_schedule) ||
    canonical.rent_schedule.length === 0
  );
}

export function shouldRequireNormalizeReview(input: {
  missingFields?: string[] | null;
  warnings?: string[] | null;
  confidenceScore?: number | null;
  reviewTasks?: ExtractionReviewTask[] | null;
  canonicalVariants?: BackendCanonicalLease[] | null;
}): { needsReview: boolean; lowConfidence: boolean } {
  const missingFields = Array.isArray(input.missingFields) ? input.missingFields : [];
  const warnings = Array.isArray(input.warnings) ? input.warnings : [];
  const reviewTasks = Array.isArray(input.reviewTasks) ? input.reviewTasks : [];
  const variants = Array.isArray(input.canonicalVariants) ? input.canonicalVariants : [];
  const confidenceScore = Number(input.confidenceScore ?? 0);

  const hasCriticalMissing = missingFields.some((field) => CRITICAL_MISSING_FIELDS.has(String(field)));
  const hasHardReviewWarning = warnings.some((warning) =>
    HARD_REVIEW_WARNING_PATTERNS.some((pattern) => pattern.test(String(warning ?? "")))
  );
  const hasBlockerReviewTask = reviewTasks.some(
    (task) => String(task?.severity ?? "").toLowerCase() === "blocker"
  );
  const hasWarnReviewTask = reviewTasks.some(
    (task) => String(task?.severity ?? "").toLowerCase() === "warn"
  );
  const hasInvalidCoreValues = variants.some((variant) => hasInvalidCanonicalCoreValues(variant));

  const lowConfidence = !Number.isFinite(confidenceScore) || confidenceScore < 0.85;
  const criticallyLowConfidence = !Number.isFinite(confidenceScore) || confidenceScore < 0.55;

  const needsReview =
    hasCriticalMissing ||
    hasHardReviewWarning ||
    hasInvalidCoreValues ||
    hasBlockerReviewTask ||
    (criticallyLowConfidence && hasWarnReviewTask);

  return { needsReview, lowConfidence };
}

export function getNormalizeIntakeDecision(
  data?: Pick<
    NormalizerResponse,
    "canonical_lease" | "option_variants" | "missing_fields" | "warnings" | "confidence_score" | "review_tasks"
  > | null,
): NormalizeIntakeDecision {
  const canonical = data?.canonical_lease;
  const variants = [
    canonical,
    ...(Array.isArray(data?.option_variants) ? data?.option_variants : []),
  ].filter(Boolean) as BackendCanonicalLease[];

  const review = shouldRequireNormalizeReview({
    missingFields: data?.missing_fields || [],
    warnings: data?.warnings || [],
    confidenceScore: data?.confidence_score,
    reviewTasks: data?.review_tasks || [],
    canonicalVariants: variants,
  });

  const missingFields = Array.isArray(data?.missing_fields) ? data?.missing_fields : [];
  const warnings = Array.isArray(data?.warnings) ? data?.warnings : [];
  const reviewTasks = Array.isArray(data?.review_tasks) ? data?.review_tasks : [];

  const hasCriticalMissing = missingFields.some((field) => CRITICAL_MISSING_FIELDS.has(String(field)));
  const hasHardReviewWarning = warnings.some((warning) =>
    HARD_REVIEW_WARNING_PATTERNS.some((pattern) => pattern.test(String(warning ?? ""))),
  );
  const hasBlockerReviewTask = reviewTasks.some(
    (task) => String(task?.severity ?? "").toLowerCase() === "blocker",
  );
  const hasInvalidCoreValues = variants.length === 0 || variants.some((variant) => hasInvalidCanonicalCoreValues(variant));

  const parsed = !hasCriticalMissing && !hasHardReviewWarning && !hasBlockerReviewTask && !hasInvalidCoreValues;
  const requiresReview = !parsed || review.needsReview;
  const autoAdd = parsed && !requiresReview;

  let message = "Extraction is ready to add to the comparison.";
  if (!parsed) {
    message = "Extraction found the document, but the core lease terms are still incomplete. Upload the source lease or proposal again so the extractor can rebuild the scenario cleanly.";
  } else if (requiresReview) {
    message = "Extraction found unresolved lease conflicts that still need a cleaner source document before this scenario can be added.";
  } else if (review.lowConfidence) {
    message = "Extraction is being auto-added with repaired confidence and validation notes.";
  }

  return {
    parsed,
    autoAdd,
    requiresReview,
    lowConfidence: review.lowConfidence,
    message,
  };
}
