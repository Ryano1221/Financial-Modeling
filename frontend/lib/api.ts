/**
 * API helpers: call Render backend directly via NEXT_PUBLIC_BACKEND_URL.
 * No Vercel proxy; avoids 60s Hobby timeout on lease uploads.
 */
import { getBackendBaseUrl } from "./backend";
import { getAccessToken } from "./auth-token";
import { refreshPersistedSession } from "./supabase";

const DEFAULT_TIMEOUT_MS = 300000; // 5 min for Render cold start + extraction
const NORMALIZE_TIMEOUT_MS = 300000; // 5 min for /normalize to handle large/scanned lease docs
const NORMALIZE_TIMEOUT_MESSAGE = "Backend took too long while processing this lease. Check Render logs for normalize request id.";
const FRIENDLY_MESSAGE = "We're having trouble connecting right now. Please try again.";

/** Single user-facing error for all lease/processing failures. Never show backend URLs, CLI, or stack traces. */
export const USER_FACING_ERROR_MESSAGE =
  "We're having trouble processing this lease. Please review inputs or try again.";

/** Full URL for a backend path. Uses NEXT_PUBLIC_BACKEND_URL (throws if unset). */
export function getApiUrl(path: string): string {
  const base = getBackendBaseUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Same-origin proxy URL for backend path (avoids CORS in browser). */
export function getProxyApiUrl(path: string): string {
  return `/api${path.startsWith("/") ? path : `/${path}`}`;
}

/** Base URL for backend. */
export function getBaseUrl(): string {
  return getBackendBaseUrl();
}

export const CONNECTION_MESSAGE = FRIENDLY_MESSAGE;

const FORBIDDEN_IN_ERROR = [
  "127.0.0.1",
  "localhost",
  "npm run",
  "npx ",
  "curl ",
  "getApiUrl",
  "fetchApi",
  "at ",
  ".py",
  ".ts:",
  ".tsx:",
];

function parseBackendErrorText(raw: string): string {
  const clean = String(raw || "").trim();
  if (!clean) return "";
  try {
    const parsed = JSON.parse(clean) as { detail?: unknown; message?: unknown; error?: unknown; details?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail.trim();
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.details === "string" && parsed.details.trim()) return parsed.details.trim();
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // Non-JSON error body; use raw text.
  }
  return clean;
}

function getSafeKnownErrorMessage(raw: string): string | null {
  const normalized = parseBackendErrorText(raw);
  const lower = normalized.toLowerCase();

  if (lower.includes("file too large for normalization") || lower.includes("limit is 20971520 bytes")) {
    return "This file is too large to process here. Upload a lease file under 20MB.";
  }
  if (lower.includes("file must be pdf")) {
    return "Only PDF files are allowed for this upload.";
  }
  if (lower.includes("file must be docx or doc")) {
    return "Only DOCX or DOC files are allowed for this upload.";
  }
  if (lower.includes("empty file")) {
    return "This file appears empty. Please choose a valid lease document.";
  }
  if (lower.includes("file required for pdf/word")) {
    return "Please attach a lease file before submitting.";
  }
  if (lower.includes("generated analysis/report pdf")) {
    return "This looks like a generated report, not a source lease. Upload the original lease/proposal/amendment.";
  }
  if (lower.includes("backend took too long") || lower.includes("upstream timeout")) {
    return "This lease took too long to process. Try again. If it keeps happening, contact support with the document name.";
  }
  if (lower.includes("session expired")) {
    return "Session expired. Please sign in again.";
  }
  return null;
}

/** Return a safe user-facing message: never expose URLs, CLI, or stack traces. */
export function getDisplayErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const known = getSafeKnownErrorMessage(raw);
  if (known) return known;
  if (process.env.NODE_ENV === "production") return USER_FACING_ERROR_MESSAGE;
  const msg = parseBackendErrorText(raw);
  const lower = msg.toLowerCase();
  if (FORBIDDEN_IN_ERROR.some((f) => lower.includes(f.toLowerCase()))) return USER_FACING_ERROR_MESSAGE;
  return msg || USER_FACING_ERROR_MESSAGE;
}

export type ApiHeaders = Record<string, string>;

export function getAuthHeaders(): ApiHeaders {
  const headers: ApiHeaders = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function attachAuthHeader(init: RequestInit): RequestInit {
  const token = getAccessToken();
  if (!token) return init;

  const headers = new Headers(init.headers || undefined);
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

async function retryWithFreshSession(
  fetcher: (init: RequestInit) => Promise<Response>,
  init: RequestInit,
  firstResponse: Response,
): Promise<Response> {
  if (!isAuthFailure(firstResponse.status)) return firstResponse;
  const refreshed = await refreshPersistedSession();
  if (!refreshed) return firstResponse;
  return fetcher(attachAuthHeader(init));
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(id),
  };
}

/** Fetch backend directly; long timeout for cold start. Throws friendly message on network error. */
export async function fetchApi(
  path: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const isNormalize = path === "/normalize" || path.endsWith("/normalize");
  const timeout = isNormalize ? NORMALIZE_TIMEOUT_MS : timeoutMs;
  const url = getApiUrl(path);
  const { signal, clear } = withTimeoutSignal(timeout);
  const initWithAuth = attachAuthHeader(init);
  try {
    const doFetch = (nextInit: RequestInit) => fetch(url, { ...nextInit, signal });
    const res = await doFetch(initWithAuth);
    const finalRes = await retryWithFreshSession(doFetch, init, res);
    clear();
    return finalRes;
  } catch (e) {
    clear();
    if (isNormalize && e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("abort"))) {
      throw new Error(NORMALIZE_TIMEOUT_MESSAGE);
    }
    throw new Error(FRIENDLY_MESSAGE);
  }
}

/** Fetch via same-origin /api proxy route (useful for browser CORS-sensitive flows like PDF downloads). */
export async function fetchApiProxy(
  path: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const isNormalize = path === "/normalize" || path.endsWith("/normalize");
  const timeout = isNormalize ? NORMALIZE_TIMEOUT_MS : timeoutMs;
  const url = getProxyApiUrl(path);
  const { signal, clear } = withTimeoutSignal(timeout);
  const initWithAuth = attachAuthHeader(init);
  try {
    const doFetch = (nextInit: RequestInit) => fetch(url, { ...nextInit, signal });
    const res = await doFetch(initWithAuth);
    const finalRes = await retryWithFreshSession(doFetch, init, res);
    clear();
    return finalRes;
  } catch (e) {
    clear();
    if (isNormalize && e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("abort"))) {
      throw new Error(NORMALIZE_TIMEOUT_MESSAGE);
    }
    throw new Error(FRIENDLY_MESSAGE);
  }
}
