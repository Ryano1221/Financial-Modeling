import type { BackendCanonicalLease, ExtractionReviewTask } from "@/lib/types";

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
