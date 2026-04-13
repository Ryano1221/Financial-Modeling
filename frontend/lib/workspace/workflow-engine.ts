import type { BrokerageOsActor } from "@/lib/workspace/os-types";
import {
  DEFAULT_DEAL_STAGES,
  getDefaultDealStagesForMode,
  type ClientWorkspaceDeal,
} from "@/lib/workspace/types";
import type { RepresentationMode } from "@/lib/workspace/representation-mode";

export const BROKERAGE_WORKFLOW_STAGES: readonly string[] = DEFAULT_DEAL_STAGES;

export function getWorkflowStagesForMode(
  mode: RepresentationMode | null | undefined,
): readonly string[] {
  return getDefaultDealStagesForMode(mode);
}

const TERMINAL_STAGES = new Set<string>(["Lost"]);
const REVIVE_ALLOWED_FROM = new Set<string>(["On Hold", "Lost"]);

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

function stageIndex(stages: readonly string[], stage: string): number {
  const n = normalize(stage);
  return stages.findIndex((candidate) => normalize(candidate) === n);
}

export interface WorkflowTransitionDecision {
  allowed: boolean;
  reason: string;
  fromStage: string;
  toStage: string;
  autoStatus?: ClientWorkspaceDeal["status"];
}

export function getWorkflowTransitionDecision(input: {
  currentStage: string;
  targetStage: string;
  allowReverse?: boolean;
  workflowStages?: readonly string[];
}): WorkflowTransitionDecision {
  const workflowStages = Array.isArray(input.workflowStages) && input.workflowStages.length > 0
    ? input.workflowStages
    : BROKERAGE_WORKFLOW_STAGES;
  const fromStage = asText(input.currentStage);
  const toStage = asText(input.targetStage);
  if (!toStage) {
    return { allowed: false, reason: "Target stage is required.", fromStage, toStage };
  }
  if (normalize(fromStage) === normalize(toStage)) {
    return { allowed: false, reason: "Deal is already in this stage.", fromStage, toStage };
  }

  const fromIdx = stageIndex(workflowStages, fromStage);
  const toIdx = stageIndex(workflowStages, toStage);
  if (toIdx < 0) {
    return { allowed: false, reason: "Target stage is not part of workflow.", fromStage, toStage };
  }
  if (fromIdx < 0) {
    return { allowed: true, reason: "Current stage not recognized; transition allowed.", fromStage, toStage };
  }

  if (TERMINAL_STAGES.has(fromStage) && !REVIVE_ALLOWED_FROM.has(fromStage)) {
    return { allowed: false, reason: "Current stage is terminal.", fromStage, toStage };
  }

  if (!input.allowReverse && toIdx < fromIdx && !REVIVE_ALLOWED_FROM.has(fromStage)) {
    return { allowed: false, reason: "Reverse transition is not allowed.", fromStage, toStage };
  }

  let autoStatus: ClientWorkspaceDeal["status"] | undefined;
  if (normalize(toStage) === "executed") autoStatus = "won";
  if (normalize(toStage) === "lost") autoStatus = "lost";
  if (normalize(toStage) === "on hold") autoStatus = "on_hold";
  if (!autoStatus && REVIVE_ALLOWED_FROM.has(fromStage)) autoStatus = "open";

  return {
    allowed: true,
    reason: "Transition allowed.",
    fromStage,
    toStage,
    autoStatus,
  };
}

export interface WorkflowTransitionPayload {
  dealId: string;
  clientId: string;
  fromStage: string;
  toStage: string;
  actor: BrokerageOsActor;
  source: "user" | "ai" | "automation";
  createdAt: string;
  reason: string;
}

export function buildWorkflowTransitionLabel(payload: WorkflowTransitionPayload): string {
  return `${payload.fromStage} -> ${payload.toStage} via ${payload.source}`;
}

export function inferWorkflowStageFromDocumentType(type: string): string | null {
  const normalized = normalize(type);
  if (!normalized) return null;
  if (normalized === "marketing") return "Survey";
  if (normalized === "surveys" || normalized === "flyers" || normalized === "floorplans") return "Survey";
  if (normalized === "proposals") return "Proposal Received";
  if (normalized === "lois" || normalized === "counters" || normalized === "redlines") return "Negotiation";
  if (normalized === "financial analyses" || normalized === "sublease documents") return "Financial Analysis";
  if (normalized === "leases") return "Lease Drafting";
  if (normalized === "amendments" || normalized === "abstracts") return "Lease Review";
  return null;
}
