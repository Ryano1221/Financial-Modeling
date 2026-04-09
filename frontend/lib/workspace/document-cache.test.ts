import { buildCompactDocumentCache, buildLocalStorageDocumentCache } from "@/lib/workspace/document-cache";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

function makeDocument(overrides: Partial<ClientWorkspaceDocument> = {}): ClientWorkspaceDocument {
  return {
    id: "doc_1",
    clientId: "client_1",
    name: "Proposal.docx",
    type: "proposals",
    building: "1300 East 5th",
    address: "1300 E 5th St",
    suite: "4th Floor",
    parsed: true,
    uploadedBy: "Tester",
    uploadedAt: "2026-04-08T19:00:00.000Z",
    sourceModule: "financial-analyses",
    ...overrides,
  };
}

describe("buildCompactDocumentCache", () => {
  it("strips large non-image preview payloads and normalize snapshots", () => {
    const result = buildCompactDocumentCache([
      makeDocument({
        fileMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        previewDataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${"a".repeat(400000)}`,
        normalizeSnapshot: {
          canonical_lease: {
            lease_type: "NNN",
          } as never,
        },
      }),
    ]);

    expect(result[0]?.previewDataUrl).toBeUndefined();
    expect(result[0]?.normalizeSnapshot).toBeUndefined();
    expect(result[0]?.fileMimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("keeps small image previews for lightweight inline browser previews", () => {
    const result = buildCompactDocumentCache([
      makeDocument({
        name: "site-plan.png",
        type: "floorplans",
        fileMimeType: "image/png",
        previewDataUrl: `data:image/png;base64,${"a".repeat(5000)}`,
      }),
    ]);

    expect(result[0]?.previewDataUrl).toContain("data:image/png;base64,");
  });
});

describe("buildLocalStorageDocumentCache", () => {
  it("stores metadata only so browser fallback does not exceed localStorage quotas", () => {
    const result = buildLocalStorageDocumentCache([
      makeDocument({
        fileMimeType: "application/pdf",
        previewDataUrl: `data:application/pdf;base64,${"a".repeat(400000)}`,
        normalizeSnapshot: {
          canonical_lease: {
            lease_type: "NNN",
          } as never,
        },
      }),
    ]);

    expect(result[0]?.previewDataUrl).toBeUndefined();
    expect(result[0]?.normalizeSnapshot).toBeUndefined();
    expect(result[0]?.fileMimeType).toBe("application/pdf");
    expect(result[0]?.name).toBe("Proposal.docx");
  });
});
