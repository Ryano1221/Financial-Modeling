import { describe, expect, it } from "vitest";
import { buildWorkspaceEntityGraph } from "@/lib/workspace/entities";
import type { ClientWorkspaceClient, ClientWorkspaceDocument } from "@/lib/workspace/types";

const sampleClient: ClientWorkspaceClient = {
  id: "client_a",
  name: "Acme Tenant",
  companyType: "",
  industry: "",
  contactName: "",
  contactEmail: "",
  website: "",
  brokerage: "JLL",
  notes: "",
  createdAt: "2026-03-10T00:00:00.000Z",
};

const sampleDocuments: ClientWorkspaceDocument[] = [
  {
    id: "doc_fin",
    clientId: "client_a",
    name: "Financial Deck",
    type: "financial analyses",
    building: "IBC Bank Plaza",
    address: "321 W 6th St, Austin, TX",
    suite: "950",
    parsed: true,
    uploadedBy: "User",
    uploadedAt: "2026-03-10T00:00:00.000Z",
    sourceModule: "financial-analyses",
  },
  {
    id: "doc_lease",
    clientId: "client_a",
    name: "Executed Lease",
    type: "leases",
    building: "IBC Bank Plaza",
    address: "321 W 6th St, Austin, TX",
    suite: "950",
    parsed: true,
    uploadedBy: "User",
    uploadedAt: "2026-03-10T00:00:00.000Z",
    sourceModule: "completed-leases",
  },
  {
    id: "doc_survey",
    clientId: "client_a",
    name: "Market Flyer",
    type: "flyers",
    building: "ATX Tower",
    address: "321 W 6th St, Austin, TX",
    suite: "1550",
    parsed: true,
    uploadedBy: "User",
    uploadedAt: "2026-03-10T00:00:00.000Z",
    sourceModule: "surveys",
  },
];

describe("workspace/entities", () => {
  it("builds normalized entity relationships from clients and documents", () => {
    const graph = buildWorkspaceEntityGraph({
      clients: [sampleClient],
      documents: sampleDocuments,
    });

    expect(graph.clients).toHaveLength(1);
    expect(graph.companies).toHaveLength(1);
    expect(graph.companies[0].name).toBe("JLL");
    expect(graph.companies[0].documentIds.length).toBe(3);

    expect(graph.buildings.length).toBe(2);
    expect(graph.spaces.length).toBe(2);
    expect(graph.analyses).toHaveLength(1);
    expect(graph.surveys).toHaveLength(1);
    expect(graph.obligations).toHaveLength(1);
    expect(graph.obligations[0].sourceDocumentIds).toContain("doc_lease");
  });
});
