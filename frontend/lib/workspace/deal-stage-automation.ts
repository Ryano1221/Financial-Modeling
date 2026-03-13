import type { ClientDocumentType } from "@/lib/workspace/types";

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stageMatchesHint(stage: string, hint: string): boolean {
  const normalizedStage = normalize(stage);
  const normalizedHint = normalize(hint);
  if (!normalizedStage || !normalizedHint) return false;
  if (normalizedStage === normalizedHint) return true;
  if (normalizedStage.includes(normalizedHint)) return true;
  const hintParts = normalizedHint.split(" ").filter(Boolean);
  if (hintParts.length === 0) return false;
  return hintParts.every((part) => normalizedStage.includes(part));
}

const DOCUMENT_STAGE_HINTS: Record<ClientDocumentType, string[]> = {
  proposals: ["Proposal Received", "Proposal Out", "Proposal Received / Countering", "Proposal Requested", "Negotiation"],
  lois: ["LOI", "Negotiation", "Proposal Received / Countering", "Proposal Received"],
  counters: ["Proposal Received / Countering", "Negotiation", "Proposal Received"],
  leases: ["Lease Drafting", "Lease Review", "Executed"],
  amendments: ["Lease Review", "Executed", "Proposal Received / Countering"],
  redlines: ["Negotiation", "Lease Review", "Proposal Received / Countering"],
  surveys: ["Survey", "Market Survey", "Tour Scheduled", "Touring", "Toured"],
  flyers: ["Survey", "Market Survey", "Tour Scheduled", "Touring", "Toured"],
  floorplans: ["Survey", "Market Survey", "Tour Scheduled", "Touring", "Toured"],
  abstracts: ["Executed", "Lease Review"],
  "financial analyses": ["Financial Analysis", "Proposal Received / Countering", "Negotiation"],
  "sublease documents": ["Financial Analysis", "Proposal Received / Countering", "Negotiation"],
  other: [],
};

export interface DealDocumentStageTransition {
  nextStage: string;
  documentType: ClientDocumentType;
  shouldMarkWon: boolean;
  reason: string;
}

function findStageIndex(stages: string[], label: string): number {
  return stages.findIndex((stage) => normalize(stage) === normalize(label));
}

function findFirstStageByHints(stages: string[], hints: string[]): string | null {
  for (const hint of hints) {
    const exact = stages.find((stage) => normalize(stage) === normalize(hint));
    if (exact) return exact;
  }
  for (const hint of hints) {
    const partial = stages.find((stage) => stageMatchesHint(stage, hint));
    if (partial) return partial;
  }
  return null;
}

export function inferStageFromDocumentType(stages: string[], documentType: ClientDocumentType): string | null {
  const hints = DOCUMENT_STAGE_HINTS[documentType] || [];
  if (hints.length === 0) return null;
  return findFirstStageByHints(stages, hints);
}

export function getDealDocumentStageTransition(input: {
  stages: string[];
  currentStage: string;
  documentType: ClientDocumentType;
}): DealDocumentStageTransition | null {
  const stages = input.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;

  const targetStage = inferStageFromDocumentType(stages, input.documentType);
  if (!targetStage) return null;

  const currentIdx = findStageIndex(stages, input.currentStage);
  const targetIdx = findStageIndex(stages, targetStage);
  if (targetIdx < 0) return null;
  if (currentIdx >= 0 && targetIdx <= currentIdx) return null;

  const shouldMarkWon = normalize(targetStage).includes("executed");
  return {
    nextStage: targetStage,
    documentType: input.documentType,
    shouldMarkWon,
    reason: `Detected ${input.documentType} document`,
  };
}
