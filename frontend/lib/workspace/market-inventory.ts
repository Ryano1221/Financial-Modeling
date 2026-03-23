import { fetchApiProxy, getAuthHeaders } from "@/lib/api";
import type { CrmBuilding } from "@/lib/workspace/crm";

export interface SharedMarketInventoryResponse {
  source: string;
  updated_at?: string | null;
  count: number;
  summary?: Record<string, unknown> | null;
  records: CrmBuilding[];
}

function parseErrorText(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // ignore
  }
  return text;
}

export async function fetchSharedMarketInventory(): Promise<SharedMarketInventoryResponse> {
  const res = await fetchApiProxy("/market-inventory", {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const body = parseErrorText(await res.text());
    throw new Error(body || `Shared market inventory fetch failed (${res.status}).`);
  }
  return (await res.json()) as SharedMarketInventoryResponse;
}

export async function uploadCostarMarketInventory(file: File): Promise<SharedMarketInventoryResponse> {
  const form = new FormData();
  form.append("file", file);
  const headers = getAuthHeaders();
  delete headers["Content-Type"];
  const res = await fetchApiProxy("/market-inventory/import/costar", {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const body = parseErrorText(await res.text());
    throw new Error(body || `CoStar market inventory import failed (${res.status}).`);
  }
  return (await res.json()) as SharedMarketInventoryResponse;
}
