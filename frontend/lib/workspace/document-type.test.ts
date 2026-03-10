import { describe, expect, it } from "vitest";
import { inferWorkspaceDocumentType } from "@/lib/workspace/document-type";

describe("workspace/document-type", () => {
  it("classifies RFP files as proposals even when sublease appears in extracted metadata", () => {
    const result = inferWorkspaceDocumentType(
      "RFP Capital View Center C - Signal Wealth - 2.11.26.docx",
      "financial-analyses",
      {
        canonical_lease: { document_type_detected: "sublease" } as never,
        extraction_summary: { document_type_detected: "sublease" } as never,
      },
    );
    expect(result).toBe("proposals");
  });

  it("keeps explicit sublease classification when no stronger proposal/RFP signal exists", () => {
    const result = inferWorkspaceDocumentType(
      "Sublease Agreement - Suite 1200.docx",
      "sublease-recovery",
      {
        canonical_lease: { document_type_detected: "sublease" } as never,
        extraction_summary: { document_type_detected: "sublease" } as never,
      },
    );
    expect(result).toBe("sublease documents");
  });
});
