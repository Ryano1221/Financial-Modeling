function asText(value: unknown): string {
  return String(value || "").trim();
}

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
]);

function lower(value: unknown): string {
  return asText(value).toLowerCase();
}

export function inferDocumentMimeType(name: string, providedType?: string): string {
  const explicit = lower(providedType);
  if (explicit) return explicit;
  const fileName = lower(name);
  if (fileName.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (fileName.endsWith(".doc")) return "application/msword";
  if (fileName.endsWith(".pdf")) return "application/pdf";
  return "";
}

export function isWordDocumentMimeType(value: string): boolean {
  return WORD_MIME_TYPES.has(lower(value));
}

export function isWordDocumentName(name: string): boolean {
  const fileName = lower(name);
  return fileName.endsWith(".docx") || fileName.endsWith(".doc");
}

export function isWordDocumentFile(file?: Pick<File, "name" | "type"> | null): boolean {
  if (!file) return false;
  return isWordDocumentMimeType(inferDocumentMimeType(file.name, file.type)) || isWordDocumentName(file.name);
}

export function isImagePreviewDataUrl(value?: string | null): boolean {
  return lower(value).startsWith("data:image/");
}

export function isPdfPreviewDataUrl(value?: string | null): boolean {
  return lower(value).startsWith("data:application/pdf");
}

export function isWordPreviewDataUrl(value?: string | null): boolean {
  const dataUrl = lower(value);
  return dataUrl.startsWith("data:application/msword")
    || dataUrl.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    || dataUrl.startsWith("data:application/vnd.ms-word.document.macroenabled.12");
}

export function canInlinePreviewDataUrl(value?: string | null): boolean {
  return isImagePreviewDataUrl(value) || isPdfPreviewDataUrl(value);
}
