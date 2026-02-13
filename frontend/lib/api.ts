/**
 * API helpers: URL from getBackendBaseUrl (no localhost default), 60s timeout, friendly errors.
 * Browser always calls same-origin /api when NEXT_PUBLIC_BACKEND_URL is unset (Vercel proxy).
 */
import { getBackendBaseUrl } from "./backend";

const DEFAULT_TIMEOUT_MS = 60000; // Render cold start
const FRIENDLY_MESSAGE = "We're having trouble connecting right now. Please try again.";

/** Base URL for backend. Empty string = same-origin /api (no localhost). */
export function getBaseUrl(): string {
  return getBackendBaseUrl();
}

/** Full URL for a backend path. Uses /api when base is unset (proxy). */
export function getApiUrl(path: string): string {
  const base = getBackendBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : `/api${p}`;
}

export const CONNECTION_MESSAGE = FRIENDLY_MESSAGE;

export type ApiHeaders = Record<string, string>;

export function getAuthHeaders(): ApiHeaders {
  return { "Content-Type": "application/json" };
}

/** Fetch with timeout; throws with friendly message on network error (no "Failed to fetch", no URLs). */
export async function fetchApi(
  path: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const url = getApiUrl(path);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw new Error(FRIENDLY_MESSAGE);
  }
}
