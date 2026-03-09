import { getApiUrl } from "@/lib/api";
import { inferRentEscalationPercentFromSteps } from "@/lib/rent-escalation";
import type { NormalizerResponse } from "@/lib/types";
import type {
  ExistingObligation,
  ImportedProposalFieldReview,
  ImportedProposalMeta,
  SubleaseScenario,
} from "@/lib/sublease-recovery/types";
import type { LeaseType } from "@/lib/lease-engine/canonical-schema";

const NORMALIZE_TIMEOUT_MS = 180000;

function parseIsoDate(value: string): Date {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(Date.UTC(2026, 0, 1));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatIsoDate(value: Date): string {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(iso: string, months: number): string {
  const date = parseIsoDate(iso);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const monthEnd = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, monthEnd));
  return formatIsoDate(next);
}

function monthCountInclusive(startIso: string, endIso: string): number {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() >= start.getUTCDate()) months += 1;
  return Math.max(1, months);
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLeaseType(leaseTypeRaw: unknown, expenseStructureRaw: unknown): LeaseType {
  const leaseType = cleanString(leaseTypeRaw).toLowerCase();
  const expense = cleanString(expenseStructureRaw).toLowerCase();
  if (expense === "base_year" || expense === "gross_with_stop" || leaseType.includes("base year") || leaseType.includes("modified")) {
    return "base_year";
  }
  if (leaseType.includes("full") || leaseType === "gross") {
    return "full_service";
  }
  if (leaseType.includes("expense stop")) {
    return "expense_stop";
  }
  if (leaseType.includes("modified gross")) {
    return "modified_gross";
  }
  return "nnn";
}

function monthDiff(startIso: string, targetIso: string): number {
  const start = parseIsoDate(startIso);
  const target = parseIsoDate(targetIso);
  let months =
    (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - start.getUTCMonth());
  if (target.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function scenarioIdFromFileName(fileName: string): string {
  const base = cleanString(fileName)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `${base || "proposal"}-${Date.now().toString(36)}`;
}

function pickEvidence(
  provenance: Record<string, Array<{ snippet?: string | null; source_confidence?: number; page?: number | null }>>,
  paths: string[],
): { confidence: number | null; snippet?: string; page?: number | null } {
  for (const path of paths) {
    const entries = provenance[path];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const first = entries[0] || {};
    const confidence = typeof first.source_confidence === "number" ? first.source_confidence : null;
    return {
      confidence,
      snippet: cleanString(first.snippet || "") || undefined,
      page: typeof first.page === "number" ? first.page : null,
    };
  }
  return { confidence: null };
}

function valueNeedsReview(value: string | number, confidence: number | null, hasReviewTask: boolean): boolean {
  const isEmpty = typeof value === "string" ? cleanString(value).length === 0 : !Number.isFinite(value);
  if (isEmpty) return true;
  if (hasReviewTask) return true;
  if (confidence == null) return false;
  return confidence < 0.68;
}

function buildFieldReview(
  key: string,
  label: string,
  value: string | number,
  provenance: Record<string, Array<{ snippet?: string | null; source_confidence?: number; page?: number | null }>>,
  reviewTaskPaths: string[],
  reviewTasks: Array<{ field_path?: string }>,
): ImportedProposalFieldReview {
  const evidence = pickEvidence(provenance, reviewTaskPaths);
  const hasTask = reviewTasks.some((task) => {
    const path = cleanString(task.field_path || "");
    return reviewTaskPaths.some((candidate) => path === candidate || path.startsWith(`${candidate}.`));
  });
  const needsReview = valueNeedsReview(value, evidence.confidence, hasTask);
  return {
    key,
    label,
    value,
    confidence: evidence.confidence,
    sourceSnippet: evidence.snippet,
    sourcePage: evidence.page,
    needsReview,
    accepted: !needsReview,
  };
}

function getProposalOverlay(normalize: NormalizerResponse): Record<string, unknown> {
  const extraction = (normalize.canonical_extraction || {}) as Record<string, unknown>;
  const proposal = extraction.proposal;
  return proposal && typeof proposal === "object" ? (proposal as Record<string, unknown>) : {};
}

function getMergedProvenance(normalize: NormalizerResponse): Record<string, Array<{ snippet?: string | null; source_confidence?: number; page?: number | null }>> {
  const top = (normalize.provenance || {}) as Record<string, Array<{ snippet?: string | null; source_confidence?: number; page?: number | null }>>;
  const extraction = (normalize.canonical_extraction || {}) as Record<string, unknown>;
  const extractionProv = extraction.provenance && typeof extraction.provenance === "object"
    ? (extraction.provenance as Record<string, Array<{ snippet?: string | null; source_confidence?: number; page?: number | null }>>)
    : {};
  return { ...top, ...extractionProv };
}

export interface ProposalImportDraft {
  scenario: SubleaseScenario;
  fieldReview: ImportedProposalFieldReview[];
  parserConfidence: number;
  reviewMeta: ImportedProposalMeta;
}

export async function normalizeProposalUpload(file: File): Promise<NormalizerResponse> {
  const name = cleanString(file.name).toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx") && !name.endsWith(".doc")) {
    throw new Error("Only PDF and Word proposal files are supported.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NORMALIZE_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("source", name.endsWith(".pdf") ? "PDF" : "WORD");
    form.append("file", file);

    const res = await fetch(getApiUrl("/normalize"), {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    const body = await res.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      throw new Error(`Proposal parsing returned invalid JSON (${res.status}).`);
    }

    if (!res.ok) {
      const detail = parsed && typeof parsed === "object"
        ? cleanString((parsed as { detail?: unknown; error?: unknown }).detail || (parsed as { error?: unknown }).error || "")
        : "";
      throw new Error(detail || `Proposal parsing failed (${res.status}).`);
    }

    const normalize = parsed as NormalizerResponse;
    if (!normalize?.canonical_lease) {
      throw new Error("Proposal parsing returned no canonical lease payload.");
    }
    return normalize;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))) {
      throw new Error("Proposal parsing timed out. Please retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function mapProposalToScenarioDraft(
  normalize: NormalizerResponse,
  existing: ExistingObligation,
  sourceDocumentName: string,
): ProposalImportDraft {
  const canonical = normalize.canonical_lease;
  const proposal = getProposalOverlay(normalize);
  const provenance = getMergedProvenance(normalize);
  const reviewTasks = (normalize.review_tasks || []).map((task) => ({
    field_path: cleanString(task.field_path),
    severity: cleanString(task.severity || "warn"),
    issue_code: cleanString(task.issue_code),
    message: cleanString(task.message),
  }));

  const rentSchedule = Array.isArray(canonical.rent_schedule)
    ? canonical.rent_schedule
      .map((step) => ({
        startMonth: Math.max(0, Math.floor(toNumber((step as { start_month?: unknown }).start_month, 0))),
        endMonth: Math.max(0, Math.floor(toNumber((step as { end_month?: unknown }).end_month, 0))),
        annualRatePsf: Math.max(0, toNumber((step as { rent_psf_annual?: unknown }).rent_psf_annual, 0)),
      }))
      .filter((step) => step.endMonth >= step.startMonth)
    : [];

  const firstRate = rentSchedule[0]?.annualRatePsf || 0;
  const inferredEscalation = inferRentEscalationPercentFromSteps(
    rentSchedule.map((step) => ({
      start: step.startMonth,
      end: step.endMonth,
      rate_psf_yr: step.annualRatePsf,
    }))
  );

  const commencementDate = cleanString(canonical.commencement_date || "") || existing.commencementDate;
  const expirationDate = cleanString(canonical.expiration_date || "") || existing.expirationDate;
  const termMonths = Math.max(1, Math.floor(toNumber(canonical.term_months, monthCountInclusive(commencementDate, expirationDate))));
  const downtimeMonths = Math.max(0, monthDiff(existing.commencementDate, commencementDate));

  const freeRentPeriods = Array.isArray(canonical.free_rent_periods)
    ? canonical.free_rent_periods
      .map((period) => ({
        start: Math.max(0, Math.floor(toNumber((period as { start_month?: unknown }).start_month, 0))),
        end: Math.max(0, Math.floor(toNumber((period as { end_month?: unknown }).end_month, 0))),
      }))
      .filter((period) => period.end >= period.start)
    : [];
  const fallbackFreeRentMonths = Math.max(0, Math.floor(toNumber(canonical.free_rent_months, 0)));
  const rentAbatementMonths = freeRentPeriods.length > 0
    ? freeRentPeriods.reduce((sum, period) => sum + Math.max(0, period.end - period.start + 1), 0)
    : fallbackFreeRentMonths;
  const firstAbatementStart = freeRentPeriods[0]?.start ?? 0;

  const subtenantName = cleanString(proposal.subtenant_name || "");
  const propertyName = cleanString(proposal.property_name || canonical.building_name || existing.premises);
  const scenarioName = cleanString(proposal.proposal_name || (subtenantName ? `${subtenantName} Proposal` : "Imported Proposal"));
  const commissionRaw = Math.max(0, toNumber(canonical.commission_rate, 0.04));
  const commissionPercent = commissionRaw > 1 ? commissionRaw / 100 : commissionRaw;

  const scenario: SubleaseScenario = {
    id: scenarioIdFromFileName(sourceDocumentName),
    name: scenarioName,
    subtenantName,
    subtenantLegalEntity: cleanString(proposal.subtenant_legal_entity || ""),
    dbaName: cleanString(proposal.dba_name || ""),
    guarantor: cleanString(proposal.guarantor || ""),
    brokerName: cleanString(proposal.broker_name || ""),
    industry: cleanString(proposal.industry || ""),
    subtenantNotes: "",
    sourceType: "proposal_import",
    sourceDocumentName,
    sourceProposalName: cleanString(proposal.proposal_name || scenarioName),
    proposalDate: cleanString(proposal.proposal_date || ""),
    proposalExpirationDate: cleanString(proposal.proposal_expiration_date || ""),
    propertyName,
    downtimeMonths,
    subleaseCommencementDate: commencementDate,
    subleaseTermMonths: termMonths,
    subleaseExpirationDate: expirationDate,
    rsf: Math.max(0, toNumber(canonical.rsf, existing.rsf)),
    leaseType: normalizeLeaseType(canonical.lease_type, canonical.expense_structure_type),
    baseRent: firstRate,
    rentInputType: "annual_psf",
    annualBaseRentEscalation: inferredEscalation > 0 ? inferredEscalation : 0.03,
    rentEscalationType: "percent",
    baseOperatingExpense: Math.max(0, toNumber(canonical.opex_psf_year_1, 0)),
    annualOperatingExpenseEscalation: Math.max(0, toNumber(canonical.opex_growth_rate, 0.03)),
    rentAbatementStartDate: addMonths(commencementDate, firstAbatementStart),
    rentAbatementMonths,
    rentAbatementType: cleanString(canonical.free_rent_scope).toLowerCase() === "gross" ? "gross" : "base",
    customAbatementMonthlyAmount: 0,
    commissionPercent,
    constructionBudget: 0,
    tiAllowanceToSubtenant: Math.max(0, toNumber(canonical.ti_allowance_psf, 0)) * Math.max(0, toNumber(canonical.rsf, existing.rsf)),
    legalMiscFees: 0,
    otherOneTimeCosts: 0,
    parkingRatio: Math.max(
      0,
      toNumber(canonical.rsf, existing.rsf) > 0
        ? (Math.max(0, toNumber(canonical.parking_count, existing.allottedParkingSpaces)) / Math.max(1, toNumber(canonical.rsf, existing.rsf))) * 1000
        : existing.parkingRatio,
    ),
    allottedParkingSpaces: Math.max(0, Math.floor(toNumber(canonical.parking_count, existing.allottedParkingSpaces))),
    reservedPaidSpaces: 0,
    unreservedPaidSpaces: Math.max(0, Math.floor(toNumber(canonical.parking_count, existing.unreservedPaidSpaces))),
    parkingCostPerSpace: Math.max(0, toNumber(canonical.parking_rate_monthly, existing.parkingCostPerSpace)),
    annualParkingEscalation: existing.annualParkingEscalation,
    phaseInEvents: [],
    explicitBaseRentSchedule: rentSchedule,
    discountRate: Math.max(0, toNumber(canonical.discount_rate_annual, 0.08)),
    importedProposalMeta: undefined,
  };

  const fieldReview: ImportedProposalFieldReview[] = [
    buildFieldReview("name", "Scenario Name", scenario.name, provenance, ["proposal.proposal_name"], reviewTasks),
    buildFieldReview("subtenantName", "Subtenant Name", scenario.subtenantName, provenance, ["proposal.subtenant_name"], reviewTasks),
    buildFieldReview("subtenantLegalEntity", "Subtenant Legal Entity", scenario.subtenantLegalEntity || "", provenance, ["proposal.subtenant_legal_entity"], reviewTasks),
    buildFieldReview("guarantor", "Guarantor", scenario.guarantor || "", provenance, ["proposal.guarantor"], reviewTasks),
    buildFieldReview("brokerName", "Broker / Representative", scenario.brokerName || "", provenance, ["proposal.broker_name"], reviewTasks),
    buildFieldReview("propertyName", "Property Name", scenario.propertyName || "", provenance, ["proposal.property_name"], reviewTasks),
    buildFieldReview("rsf", "Rentable Square Footage", scenario.rsf, provenance, ["premises.rsf", "proposal.rentable_square_footage"], reviewTasks),
    buildFieldReview("subleaseCommencementDate", "Commencement Date", scenario.subleaseCommencementDate, provenance, ["term.commencement_date"], reviewTasks),
    buildFieldReview("subleaseExpirationDate", "Expiration Date", scenario.subleaseExpirationDate, provenance, ["term.expiration_date"], reviewTasks),
    buildFieldReview("subleaseTermMonths", "Term (Months)", scenario.subleaseTermMonths, provenance, ["term.term_months"], reviewTasks),
    buildFieldReview("baseRent", "Starting Base Rent ($/SF/YR)", scenario.baseRent, provenance, ["rent_steps"], reviewTasks),
    buildFieldReview("annualBaseRentEscalation", "Annual Base Rent Escalation", scenario.annualBaseRentEscalation, provenance, ["rent_steps"], reviewTasks),
    buildFieldReview("baseOperatingExpense", "Base OpEx ($/SF/YR)", scenario.baseOperatingExpense, provenance, ["opex.base_psf_year_1"], reviewTasks),
    buildFieldReview("annualOperatingExpenseEscalation", "OpEx Escalation", scenario.annualOperatingExpenseEscalation, provenance, ["opex.growth_rate"], reviewTasks),
    buildFieldReview("rentAbatementMonths", "Rent Abatement (Months)", scenario.rentAbatementMonths, provenance, ["abatements"], reviewTasks),
    buildFieldReview("parkingCostPerSpace", "Parking Cost / Space / Month", scenario.parkingCostPerSpace, provenance, ["proposal.parking_rate", "premises.parking"], reviewTasks),
  ];

  const parserConfidence = Math.max(0, Math.min(1, toNumber(normalize.confidence_score, 0.5)));
  const reviewMeta: ImportedProposalMeta = {
    parserConfidence,
    reviewTasks: reviewTasks.map((task) => ({
      fieldPath: task.field_path,
      severity: task.severity,
      issueCode: task.issue_code,
      message: task.message,
    })),
    extractedFields: fieldReview,
  };
  scenario.importedProposalMeta = reviewMeta;

  return {
    scenario,
    fieldReview,
    parserConfidence,
    reviewMeta,
  };
}
