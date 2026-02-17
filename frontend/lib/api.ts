/**
 * API helpers: call Render backend directly via NEXT_PUBLIC_BACKEND_URL.
 * No Vercel proxy; avoids 60s Hobby timeout on lease uploads.
 */
import { getBackendBaseUrl } from "./backend";

const DEFAULT_TIMEOUT_MS = 300000; // 5 min for Render cold start + extraction
const NORMALIZE_TIMEOUT_MS = 180000; // 3 min for /normalize only
const NORMALIZE_TIMEOUT_MESSAGE = "Backend took too long. Check Render logs for normalize request id.";
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

/** Return a safe user-facing message: never expose URLs, CLI, or stack traces. */
export function getDisplayErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "production") return USER_FACING_ERROR_MESSAGE;
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (FORBIDDEN_IN_ERROR.some((f) => lower.includes(f.toLowerCase()))) return USER_FACING_ERROR_MESSAGE;
  return msg || USER_FACING_ERROR_MESSAGE;
}

export type ApiHeaders = Record<string, string>;

export function getAuthHeaders(): ApiHeaders {
  return { "Content-Type": "application/json" };
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
  try {
    const res = await fetch(url, { ...init, signal });
    clear();
    return res;
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
  try {
    const res = await fetch(url, { ...init, signal });
    clear();
    return res;
  } catch (e) {
    clear();
    if (isNormalize && e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("abort"))) {
      throw new Error(NORMALIZE_TIMEOUT_MESSAGE);
    }
    throw new Error(FRIENDLY_MESSAGE);
  }
}
