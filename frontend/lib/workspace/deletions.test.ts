import { describe, expect, it } from "vitest";
import { filterDocumentsByDeletedIds, getWorkspaceBuildingDeletionKey, normalizeDeletionIds } from "@/lib/workspace/deletions";
import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

function makeDocument(id: string): ClientWorkspaceDocument {
  return {
    id,
    clientId: "client-1",
    name: `${id}.pdf`,
    type: "other",
    building: "",
    address: "",
    suite: "",
    parsed: false,
    uploadedBy: "User",
    uploadedAt: "2026-03-26T00:00:00.000Z",
    sourceModule: "document-center",
  };
}

describe("workspace deletions", () => {
  it("normalizes deletion ids from JSON strings and removes duplicates", () => {
    expect(normalizeDeletionIds('["doc_1","doc_2","doc_1"]')).toEqual(["doc_1", "doc_2"]);
    expect(normalizeDeletionIds(["doc_1", " ", "doc_1", "doc_3"])).toEqual(["doc_1", "doc_3"]);
  });

  it("filters deleted documents out of the workspace list", () => {
    const documents = [makeDocument("doc_1"), makeDocument("doc_2"), makeDocument("doc_3")];
    expect(filterDocumentsByDeletedIds(documents, ["doc_2"])).toEqual([documents[0], documents[2]]);
  });

  it("uses normalized building name and address as the deletion key", () => {
    expect(getWorkspaceBuildingDeletionKey({
      id: "building_1",
      name: "  Plaza Tower ",
      address: " 500 Congress Ave ",
    })).toBe("plaza tower::500 congress ave");
    expect(getWorkspaceBuildingDeletionKey({
      id: "building_2",
      name: "",
      address: "",
    })).toBe("building_2");
  });
});
