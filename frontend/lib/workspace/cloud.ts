import { fetchApiProxy, getAuthHeaders } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-token";
import { signOut } from "@/lib/supabase";

export interface WorkspaceCloudStateResponse {
  user_id: string;
  workspace_state: Record<string, unknown>;
  updated_at?: string | null;
}

export interface WorkspaceCloudSectionResponse {
  user_id: string;
  section_key: string;
  value: unknown;
  updated_at?: string | null;
}

function parseBodyText(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // ignore non-JSON body
  }
  return raw;
}

function toWorkspaceError(message: string, fallback: string): Error {
  const msg = String(message || "").trim().toLowerCase();
  if (!msg) return new Error(fallback);
  if (msg.includes("not authenticated") || msg.includes("invalid or expired")) {
    return new Error("Session expired. Please sign in again.");
  }
  if (msg.includes("supabase is not configured") || msg.includes("service role")) {
    return new Error("Cloud workspace storage is not configured on backend.");
  }
  return new Error(message || fallback);
}

let authExpirySignOutPromise: Promise<void> | null = null;

function hasAuthExpired(status: number, message: string): boolean {
  const normalized = String(message || "").trim().toLowerCase();
  return status === 401
    || status === 403
    || normalized.includes("not authenticated")
    || normalized.includes("invalid or expired");
}

function queueSignOutOnAuthFailure(status: number, message: string): void {
  if (!hasAuthExpired(status, message)) return;
  if (authExpirySignOutPromise) return;
  authExpirySignOutPromise = signOut().finally(() => {
    authExpirySignOutPromise = null;
  });
}

export async function fetchWorkspaceCloudState(): Promise<WorkspaceCloudStateResponse> {
  if (!getAccessToken()) {
    throw new Error("Session expired. Please sign in again.");
  }
  const res = await fetchApiProxy("/user-settings/workspace", {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const body = parseBodyText(await res.text());
    queueSignOutOnAuthFailure(res.status, body);
    throw toWorkspaceError(body, `Workspace fetch failed (${res.status}).`);
  }
  return (await res.json()) as WorkspaceCloudStateResponse;
}

export async function saveWorkspaceCloudState(workspaceState: Record<string, unknown>): Promise<WorkspaceCloudStateResponse> {
  if (!getAccessToken()) {
    throw new Error("Session expired. Please sign in again.");
  }
  const res = await fetchApiProxy("/user-settings/workspace", {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ workspace_state: workspaceState }),
  });
  if (!res.ok) {
    const body = parseBodyText(await res.text());
    queueSignOutOnAuthFailure(res.status, body);
    throw toWorkspaceError(body, `Workspace save failed (${res.status}).`);
  }
  return (await res.json()) as WorkspaceCloudStateResponse;
}

export async function fetchWorkspaceCloudSection(sectionKey: string): Promise<WorkspaceCloudSectionResponse> {
  if (!getAccessToken()) {
    throw new Error("Session expired. Please sign in again.");
  }
  const key = encodeURIComponent(String(sectionKey || "").trim());
  const res = await fetchApiProxy(`/user-settings/workspace/section/${key}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const body = parseBodyText(await res.text());
    queueSignOutOnAuthFailure(res.status, body);
    throw toWorkspaceError(body, `Workspace section fetch failed (${res.status}).`);
  }
  return (await res.json()) as WorkspaceCloudSectionResponse;
}

export async function saveWorkspaceCloudSection(
  sectionKey: string,
  value: unknown,
): Promise<WorkspaceCloudSectionResponse> {
  if (!getAccessToken()) {
    throw new Error("Session expired. Please sign in again.");
  }
  const key = encodeURIComponent(String(sectionKey || "").trim());
  const res = await fetchApiProxy(`/user-settings/workspace/section/${key}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const body = parseBodyText(await res.text());
    queueSignOutOnAuthFailure(res.status, body);
    throw toWorkspaceError(body, `Workspace section save failed (${res.status}).`);
  }
  return (await res.json()) as WorkspaceCloudSectionResponse;
}
