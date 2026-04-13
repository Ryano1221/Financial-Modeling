import type { ClientDocumentSourceModule, ClientDocumentType, DocumentNormalizeSnapshot } from "@/lib/workspace/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function inferWorkspaceDocumentType(
  fileName: string,
  sourceModule: ClientDocumentSourceModule,
  normalize?: DocumentNormalizeSnapshot,
): ClientDocumentType {
  const summary = asText(normalize?.extraction_summary?.document_type_detected).toLowerCase();
  const canonicalType = asText(normalize?.canonical_lease?.document_type_detected).toLowerCase();
  const haystack = `${asText(fileName).toLowerCase()} ${summary} ${canonicalType}`;

  if (haystack.includes("rfp") || haystack.includes("request for proposal")) return "proposals";
  if (haystack.includes("redline")) return "redlines";
  if (haystack.includes("amend") || haystack.includes("restatement")) return "amendments";
  if (haystack.includes("counter")) return "counters";
  if (haystack.includes("loi") || haystack.includes("letter of intent")) return "lois";
  if (haystack.includes("proposal")) return "proposals";
  if (haystack.includes("abstract")) return "abstracts";
  if (haystack.includes("survey")) return "surveys";
  if (haystack.includes("floorplan") || haystack.includes("floor plan")) return "floorplans";
  if (haystack.includes("flyer") || haystack.includes("brochure")) return "flyers";
  if (haystack.includes("sublease") || haystack.includes("sub-landlord") || haystack.includes("sub landlord")) {
    return "sublease documents";
  }
  if (haystack.includes("analysis") || haystack.includes("comparison") || haystack.includes("deck")) {
    return "financial analyses";
  }
  if (haystack.includes("lease")) return "leases";

  if (sourceModule === "sublease-recovery") return "sublease documents";
  if (sourceModule === "marketing") return "flyers";
  if (sourceModule === "surveys") return "surveys";
  if (sourceModule === "completed-leases" || sourceModule === "obligations" || sourceModule === "upload") return "leases";
  if (sourceModule === "financial-analyses") return "financial analyses";
  return "other";
}
