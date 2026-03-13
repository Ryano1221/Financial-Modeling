import type {
  BrokerageOsAiExecutionResult,
  BrokerageOsEntityGraph,
  BrokerageOsToolCall,
  BrokerageOsToolName,
  BrokerageOsToolResult,
} from "@/lib/workspace/os-types";
import { LANDLORD_REP_MODE, type RepresentationMode } from "@/lib/workspace/representation-mode";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

interface AiPlanOptions {
  representationMode?: RepresentationMode | null;
}

function detectToolCalls(
  command: string,
  options?: AiPlanOptions,
): { resolvedIntent: string; toolCalls: BrokerageOsToolCall[] } {
  const raw = asText(command);
  const n = normalize(raw);
  const isLandlordMode = options?.representationMode === LANDLORD_REP_MODE;
  if (!raw) return { resolvedIntent: "empty", toolCalls: [] };

  if (isLandlordMode) {
    if (n.includes("listing") && (n.includes("summary") || n.includes("package") || n.includes("marketing"))) {
      return {
        resolvedIntent: "landlord-listing-summary",
        toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: "landlord-listing-summary" } }],
      };
    }

    if (n.includes("availability") || n.includes("availabilities")) {
      return {
        resolvedIntent: "landlord-availability-summary",
        toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: "landlord-availability" } }],
      };
    }

    if (n.includes("inquiry") || n.includes("tour") || n.includes("proposal")) {
      return {
        resolvedIntent: "landlord-pipeline-summary",
        toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: "landlord-pipeline" } }],
      };
    }
  }

  if (n.includes("sublease recovery")) {
    return {
      resolvedIntent: "create-sublease-recovery",
      toolCalls: [
        { tool: "createSubleaseRecovery", input: { command: raw } },
        { tool: "compareProposals", input: { command: raw } },
      ],
    };
  }

  if (n.includes("survey") && (n.includes("compare") || n.includes("lowest monthly occupancy"))) {
    return {
      resolvedIntent: "compare-survey-options",
      toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: "survey" } }],
    };
  }

  if (n.includes("financial analysis") || n.includes("build analysis")) {
    return {
      resolvedIntent: "create-financial-analysis",
      toolCalls: [{ tool: "createFinancialAnalysis", input: { command: raw } }],
    };
  }

  if (n.includes("lease abstract")) {
    return {
      resolvedIntent: "create-lease-abstract",
      toolCalls: [{ tool: "createLeaseAbstract", input: { command: raw } }],
    };
  }

  if (n.includes("deals") && n.includes("proposal stage")) {
    return {
      resolvedIntent: "deal-stage-summary",
      toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: "deals-proposal-stage" } }],
    };
  }

  if (n.startsWith("create deal") || n.includes("new deal")) {
    return {
      resolvedIntent: "create-deal",
      toolCalls: [{ tool: "createDeal", input: { command: raw } }],
    };
  }

  if (n.includes("move deal") || n.includes("update stage")) {
    return {
      resolvedIntent: "update-deal-stage",
      toolCalls: [{ tool: "updateDealStage", input: { command: raw } }],
    };
  }

  if (n.includes("task")) {
    return {
      resolvedIntent: "create-task",
      toolCalls: [{ tool: "createTask", input: { command: raw } }],
    };
  }

  if (n.includes("export") && n.includes("pdf")) {
    return {
      resolvedIntent: "export-pdf",
      toolCalls: [{ tool: "exportPdf", input: { command: raw } }],
    };
  }

  if (n.includes("export") && (n.includes("excel") || n.includes("xlsx"))) {
    return {
      resolvedIntent: "export-excel",
      toolCalls: [{ tool: "exportExcel", input: { command: raw } }],
    };
  }

  if (n.includes("share link")) {
    return {
      resolvedIntent: "create-share-link",
      toolCalls: [{ tool: "createShareLink", input: { command: raw } }],
    };
  }

  return {
    resolvedIntent: isLandlordMode ? "landlord-summary" : "client-summary",
    toolCalls: [{ tool: "generateClientSummary", input: { command: raw, focus: isLandlordMode ? "landlord-general" : "general" } }],
  };
}

export function suggestToolPlan(
  command: string,
  options?: AiPlanOptions,
): { resolvedIntent: string; toolCalls: BrokerageOsToolCall[] } {
  return detectToolCalls(command, options);
}

export interface AiToolExecutionContext {
  graph: BrokerageOsEntityGraph;
  command: string;
}

export type AiToolExecutor = (
  tool: BrokerageOsToolName,
  input: Record<string, unknown>,
  context: AiToolExecutionContext,
) => Promise<BrokerageOsToolResult>;

export async function runAiCommandPlan(input: {
  command: string;
  graph: BrokerageOsEntityGraph;
  executeTool: AiToolExecutor;
  representationMode?: RepresentationMode | null;
}): Promise<BrokerageOsAiExecutionResult> {
  const command = asText(input.command);
  const plan = detectToolCalls(command, {
    representationMode: input.representationMode,
  });
  const results: BrokerageOsToolResult[] = [];
  for (const call of plan.toolCalls) {
    const result = await input.executeTool(call.tool, call.input, {
      graph: input.graph,
      command,
    });
    results.push(result);
  }
  return {
    command,
    resolvedIntent: plan.resolvedIntent,
    toolCalls: plan.toolCalls,
    results,
  };
}
