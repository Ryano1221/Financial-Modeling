import { fetchApiProxy, getAuthHeaders } from "./api";

export interface UserBrandingResponse {
  organization_id: string;
  brokerage_name?: string | null;
  has_logo: boolean;
  logo_filename?: string | null;
  logo_content_type?: string | null;
  logo_data_url?: string | null;
  logo_asset_bytes?: string | null;
  logo_storage_path?: string | null;
  theme_hash?: string | null;
  logo_updated_at?: string | null;
}

function parseBodyText(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
    return raw;
  } catch {
    return raw;
  }
}

export async function fetchUserBranding(): Promise<UserBrandingResponse> {
  const res = await fetchApiProxy("/user-settings/branding", {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(parseBodyText(await res.text()) || `Branding request failed (${res.status})`);
  }
  return (await res.json()) as UserBrandingResponse;
}

export async function uploadUserBrandingLogo(file: File): Promise<UserBrandingResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchApiProxy("/user-settings/branding/logo", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(parseBodyText(await res.text()) || `Logo upload failed (${res.status})`);
  }
  return (await res.json()) as UserBrandingResponse;
}

export async function deleteUserBrandingLogo(): Promise<UserBrandingResponse> {
  const res = await fetchApiProxy("/user-settings/branding/logo", {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(parseBodyText(await res.text()) || `Logo delete failed (${res.status})`);
  }
  return (await res.json()) as UserBrandingResponse;
}

export async function updateBrokerageName(brokerageName: string): Promise<{ brokerage_name: string | null }> {
  const res = await fetchApiProxy("/user-settings", {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      brokerage_name: brokerageName,
    }),
  });
  if (!res.ok) {
    throw new Error(parseBodyText(await res.text()) || `Brokerage update failed (${res.status})`);
  }
  return (await res.json()) as { brokerage_name: string | null };
}
