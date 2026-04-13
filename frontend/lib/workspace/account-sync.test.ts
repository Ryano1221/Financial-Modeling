import { describe, expect, it } from "vitest";
import { mergeHydratedWorkspaceState, preferLocalWhenRemoteEmpty, type HydratedWorkspaceState } from "@/lib/workspace/account-sync";

function buildState(overrides: Partial<HydratedWorkspaceState> = {}): HydratedWorkspaceState {
  return {
    representationMode: "tenant_rep",
    clients: [],
    deals: [],
    dealStageMap: {},
    crmSettingsMap: {},
    documents: [],
    deletedDocumentIds: [],
    activeClientId: null,
    ...overrides,
  };
}

describe("workspace/account-sync", () => {
  it("keeps local account state when the cloud payload is empty", () => {
    const merged = mergeHydratedWorkspaceState(
      buildState(),
      buildState({
        clients: [{ id: "client-1", name: "Acme", companyType: "", industry: "", contactName: "", contactEmail: "", website: "", brokerage: "", notes: "", createdAt: "2026-04-08T00:00:00.000Z" }],
        deals: [{ id: "deal-1", clientId: "client-1", dealName: "HQ", requirementName: "", dealType: "", stage: "Prospecting", status: "open", priority: "medium", targetMarket: "", submarket: "", city: "", squareFootageMin: 0, squareFootageMax: 0, budget: 0, occupancyDateGoal: "", expirationDate: "", selectedProperty: "", selectedSuite: "", selectedLandlord: "", tenantRepBroker: "", notes: "", linkedSurveyIds: [], linkedAnalysisIds: [], linkedDocumentIds: [], linkedObligationIds: [], linkedLeaseAbstractIds: [], timeline: [], tasks: [], createdAt: "2026-04-08T00:00:00.000Z", updatedAt: "2026-04-08T00:00:00.000Z" }],
        activeClientId: "client-1",
      }),
    );

    expect(merged.clients).toHaveLength(1);
    expect(merged.clients[0]?.id).toBe("client-1");
    expect(merged.deals).toHaveLength(1);
    expect(merged.activeClientId).toBe("client-1");
  });

  it("preserves remote records while appending local-only documents and deleted ids", () => {
    const merged = mergeHydratedWorkspaceState(
      buildState({
        clients: [{ id: "client-1", name: "Remote", companyType: "", industry: "", contactName: "", contactEmail: "", website: "", brokerage: "", notes: "", createdAt: "2026-04-08T00:00:00.000Z" }],
        documents: [{ id: "doc-1", clientId: "client-1", name: "Remote PDF", type: "leases", building: "", address: "", suite: "", parsed: true, uploadedBy: "User", uploadedAt: "2026-04-08T00:00:00.000Z", sourceModule: "document-center" }],
        deletedDocumentIds: ["doc-3"],
        activeClientId: "client-1",
      }),
      buildState({
        documents: [
          { id: "doc-1", clientId: "client-1", name: "Remote PDF", type: "leases", building: "", address: "", suite: "", parsed: true, uploadedBy: "User", uploadedAt: "2026-04-08T00:00:00.000Z", sourceModule: "document-center", previewDataUrl: "data:image/png;base64,abc" },
          { id: "doc-2", clientId: "client-1", name: "Local Only", type: "leases", building: "", address: "", suite: "", parsed: true, uploadedBy: "User", uploadedAt: "2026-04-08T00:00:00.000Z", sourceModule: "document-center" },
          { id: "doc-3", clientId: "client-1", name: "Deleted Local", type: "leases", building: "", address: "", suite: "", parsed: true, uploadedBy: "User", uploadedAt: "2026-04-08T00:00:00.000Z", sourceModule: "document-center" },
        ],
        deletedDocumentIds: ["doc-2"],
      }),
    );

    expect(merged.documents.map((document) => document.id)).toEqual(["doc-1"]);
    expect(merged.documents[0]?.previewDataUrl).toBe("data:image/png;base64,abc");
    expect(merged.deletedDocumentIds.sort()).toEqual(["doc-2", "doc-3"]);
  });

  it("uses local fallback payloads when the cloud section is empty", () => {
    const remote: { scenarios?: Array<{ id: string }>; includedInSummary?: Record<string, boolean> } = { scenarios: [], includedInSummary: {} };
    const local: { scenarios?: Array<{ id: string }>; includedInSummary?: Record<string, boolean> } = {
      scenarios: [{ id: "scenario-1" }],
      includedInSummary: { "scenario-1": true },
    };

    const resolved = preferLocalWhenRemoteEmpty(
      remote,
      local,
      (value) => Array.isArray((value as { scenarios?: unknown[] }).scenarios) && ((value as { scenarios?: unknown[] }).scenarios || []).length > 0,
    );

    expect(resolved).toEqual(local);
  });
});
