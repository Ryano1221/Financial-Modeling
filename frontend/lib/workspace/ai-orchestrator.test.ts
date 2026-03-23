import { describe, expect, it } from "vitest";
import { suggestToolPlan } from "@/lib/workspace/ai-orchestrator";

describe("workspace/ai-orchestrator", () => {
  it("routes tenant prompts through tenant-biased intent presets", () => {
    const plan = suggestToolPlan("Show clients we have not contacted recently.", {
      representationMode: "tenant_rep",
    });

    expect(plan.resolvedIntent).toBe("tenant-stale-relationships");
    expect(plan.toolCalls[0]?.tool).toBe("generateClientSummary");
    expect(plan.toolCalls[0]?.input.focus).toBe("tenant-stale-relationships");
  });

  it("routes landlord prompts through landlord-biased intent presets", () => {
    const plan = suggestToolPlan("Which availabilities have active proposals outstanding?", {
      representationMode: "landlord_rep",
    });

    expect(plan.resolvedIntent).toBe("landlord-availability-proposals");
    expect(plan.toolCalls[0]?.tool).toBe("generateClientSummary");
    expect(plan.toolCalls[0]?.input.focus).toBe("landlord-availability-proposals");
  });

  it("falls back to the mode-aware summary focus when no explicit prompt preset matches", () => {
    const plan = suggestToolPlan("Give me a quick update.", {
      representationMode: "landlord_rep",
    });

    expect(plan.resolvedIntent).toBe("landlord-summary");
    expect(plan.toolCalls[0]?.input.focus).toBe("landlord-general");
  });
});
