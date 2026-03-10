import { fetchApi } from "@/lib/api";
import type { NormalizerResponse } from "@/lib/types";

function lowerName(fileName: string): string {
  return String(fileName || "").trim().toLowerCase();
}

export function isParseableWorkspaceDocument(fileName: string): boolean {
  const name = lowerName(fileName);
  return name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".doc");
}

export async function normalizeWorkspaceDocument(file: File): Promise<NormalizerResponse | null> {
  if (!isParseableWorkspaceDocument(file.name)) return null;

  const form = new FormData();
  form.append("source", file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "WORD");
  form.append("file", file);

  const res = await fetchApi("/normalize", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Normalize request failed (${res.status}).`);
  }
  return (await res.json()) as NormalizerResponse;
}
