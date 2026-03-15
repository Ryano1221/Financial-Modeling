import type { BackendCanonicalLease } from "@/lib/types";
import type { ClientDocumentSourceModule, ClientDocumentType, DocumentNormalizeSnapshot } from "@/lib/workspace/types";

function asText(value: unknown): string {
  return String(value || "").trim();
}

function normalize(value: unknown): string {
  return asText(value).toLowerCase();
}

export interface DocumentClassificationResult {
  type: ClientDocumentType;
  classification: string;
}

function classifyByName(fileName: string): ClientDocumentType {
  const n = normalize(fileName);
  if (!n) return "other";
  if (n.includes("proposal")) return "proposals";
  if (n.includes("loi")) return "lois";
  if (n.includes("counter")) return "counters";
  if (n.includes("sublease")) return "sublease documents";
  if (n.includes("amend")) return "amendments";
  if (n.includes("lease")) return "leases";
  if (n.includes("redline")) return "redlines";
  if (n.includes("survey")) return "surveys";
  if (n.includes("flyer")) return "flyers";
  if (n.includes("floorplan")) return "floorplans";
  if (n.includes("abstract")) return "abstracts";
  if (n.includes("analysis")) return "financial analyses";
  return "other";
}

export function classifyDocument(input: {
  fileName: string;
  sourceModule: ClientDocumentSourceModule;
  snapshot?: DocumentNormalizeSnapshot;
}): DocumentClassificationResult {
  const summaryType = normalize(input.snapshot?.extraction_summary?.document_type_detected);
  if (summaryType.includes("proposal")) return { type: "proposals", classification: "proposal" };
  if (summaryType.includes("letter of intent") || summaryType.includes("loi")) return { type: "lois", classification: "loi" };
  if (summaryType.includes("counter")) return { type: "counters", classification: "counter" };
  if (summaryType.includes("amend")) return { type: "amendments", classification: "amendment" };
  if (summaryType.includes("lease")) return { type: "leases", classification: "lease" };
  if (summaryType.includes("redline")) return { type: "redlines", classification: "redline" };

  const byName = classifyByName(input.fileName);
  if (byName !== "other") return { type: byName, classification: byName };

  const moduleType: Record<ClientDocumentSourceModule, ClientDocumentType> = {
    "document-center": "other",
    "sublease-recovery": "sublease documents",
    upload: "other",
    "financial-analyses": "financial analyses",
    "completed-leases": "leases",
    surveys: "surveys",
    obligations: "leases",
    deals: "other",
    documents: "other",
  };
  const fallback = moduleType[input.sourceModule] || "other";
  return { type: fallback, classification: fallback };
}

export interface ExtractedDocumentEntities {
  tenant: string;
  landlord: string;
  building: string;
  address: string;
  floor: string;
  suite: string;
  rsf: number;
  commencement: string;
  expiration: string;
  leaseType: string;
}

export function extractEntitiesFromCanonical(canonical?: BackendCanonicalLease | null): ExtractedDocumentEntities {
  const leaseTypeRaw = asText(canonical?.lease_type).toLowerCase();
  return {
    tenant: asText(canonical?.tenant_name),
    landlord: asText(canonical?.landlord_name),
    building: asText(canonical?.building_name || canonical?.premises_name),
    address: asText(canonical?.address),
    floor: asText(canonical?.floor),
    suite: asText(canonical?.suite),
    rsf: Number(canonical?.rsf) || 0,
    commencement: asText(canonical?.commencement_date),
    expiration: asText(canonical?.expiration_date),
    leaseType: leaseTypeRaw ? leaseTypeRaw : "unknown",
  };
}

export function buildDocumentFingerprint(input: {
  clientId: string;
  fileName: string;
  fileSize?: number;
  fileLastModified?: number;
  canonical?: BackendCanonicalLease | null;
}): string {
  const bits = [
    normalize(input.clientId),
    normalize(input.fileName),
    String(Number(input.fileSize) || 0),
    String(Number(input.fileLastModified) || 0),
    normalize(input.canonical?.tenant_name),
    normalize(input.canonical?.building_name),
    normalize(input.canonical?.suite),
    normalize(input.canonical?.commencement_date),
    normalize(input.canonical?.expiration_date),
  ];
  return bits.join("::");
}
