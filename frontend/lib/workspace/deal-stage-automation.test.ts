import { describe, expect, it } from "vitest";
import { DEFAULT_DEAL_STAGES } from "@/lib/workspace/types";
import {
  getDealDocumentStageTransition,
  inferStageFromDocumentType,
} from "@/lib/workspace/deal-stage-automation";

describe("workspace/deal-stage-automation", () => {
  it("maps financial analysis docs to financial analysis stage", () => {
    expect(inferStageFromDocumentType([...DEFAULT_DEAL_STAGES], "financial analyses")).toBe(
      "Financial Analysis",
    );
  });

  it("advances to proposal received when proposal arrives", () => {
    const result = getDealDocumentStageTransition({
      stages: [...DEFAULT_DEAL_STAGES],
      currentStage: "Touring",
      documentType: "proposals",
    });
    expect(result?.nextStage).toBe("Proposal Received");
    expect(result?.shouldMarkWon).toBe(false);
  });

  it("does not move backward when stage is already ahead", () => {
    const result = getDealDocumentStageTransition({
      stages: [...DEFAULT_DEAL_STAGES],
      currentStage: "Lease Review",
      documentType: "proposals",
    });
    expect(result).toBeNull();
  });

  it("supports custom stages using partial matching", () => {
    const stages = ["Discovery", "Survey / Market", "LOI + Negotiation", "Awarded"];
    const result = getDealDocumentStageTransition({
      stages,
      currentStage: "Discovery",
      documentType: "surveys",
    });
    expect(result?.nextStage).toBe("Survey / Market");
  });

  it("marks deal won when automation reaches executed", () => {
    const result = getDealDocumentStageTransition({
      stages: [...DEFAULT_DEAL_STAGES],
      currentStage: "Lease Drafting",
      documentType: "abstracts",
    });
    expect(result?.nextStage).toBe("Executed");
    expect(result?.shouldMarkWon).toBe(true);
  });
});
