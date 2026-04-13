import type { NormalizerResponse } from "@/lib/types";
import { inferDocumentMimeType } from "@/lib/workspace/document-preview";
import type { ClientWorkspaceDocument, DocumentNormalizeSnapshot } from "@/lib/workspace/types";

const DOCUMENT_FILE_SECTION_PREFIX = "documentFile";
const DOCUMENT_SNAPSHOT_SECTION_PREFIX = "documentSnapshot";

export interface CloudDocumentFilePayload {
  name?: string;
  fileMimeType?: string;
  previewDataUrl: string;
  uploadedAt?: string;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

function safeDocumentSectionId(documentId: string): string {
  return asText(documentId).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "unknown";
}

export function getDocumentSnapshotSectionKey(documentId: string): string {
  return `${DOCUMENT_SNAPSHOT_SECTION_PREFIX}::${safeDocumentSectionId(documentId)}`;
}

export function getDocumentFileSectionKey(documentId: string): string {
  return `${DOCUMENT_FILE_SECTION_PREFIX}::${safeDocumentSectionId(documentId)}`;
}

export function toDocumentNormalizeSnapshot(
  normalize: NormalizerResponse | DocumentNormalizeSnapshot | null | undefined,
): DocumentNormalizeSnapshot | undefined {
  if (!normalize || typeof normalize !== "object") return undefined;

  if ("canonical_lease" in normalize && normalize.canonical_lease) {
    return {
      canonical_lease: normalize.canonical_lease,
      extraction_summary: "extraction_summary" in normalize ? normalize.extraction_summary : undefined,
      review_tasks: "review_tasks" in normalize ? normalize.review_tasks : undefined,
      field_confidence: "field_confidence" in normalize ? normalize.field_confidence : undefined,
      warnings: "warnings" in normalize ? normalize.warnings : undefined,
      confidence_score: "confidence_score" in normalize ? normalize.confidence_score : undefined,
      option_variants: "option_variants" in normalize ? normalize.option_variants : undefined,
    };
  }

  return undefined;
}

export function toCloudDocumentFilePayload(document: ClientWorkspaceDocument): CloudDocumentFilePayload | null {
  const previewDataUrl = asText(document.previewDataUrl);
  if (!previewDataUrl.startsWith("data:")) return null;
  return {
    name: document.name,
    fileMimeType: inferDocumentMimeType(document.name, document.fileMimeType) || undefined,
    previewDataUrl,
    uploadedAt: document.uploadedAt,
  };
}

export function parseCloudDocumentFilePayload(value: unknown): CloudDocumentFilePayload | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Partial<CloudDocumentFilePayload>;
  const previewDataUrl = asText(obj.previewDataUrl);
  if (!previewDataUrl.startsWith("data:")) return null;
  const name = asText(obj.name);
  const fileMimeType = inferDocumentMimeType(name, asText(obj.fileMimeType));
  return {
    ...(name ? { name } : {}),
    ...(fileMimeType ? { fileMimeType } : {}),
    previewDataUrl,
    uploadedAt: asText(obj.uploadedAt) || undefined,
  };
}
