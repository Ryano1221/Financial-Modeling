/**
 * API helpers: URL from getBackendBaseUrl (no localhost default), 60s timeout, friendly errors.
 * Browser always calls same-origin /api when NEXT_PUBLIC_BACKEND_URL is unset (Vercel proxy).
 */
import { getBackendBaseUrl } from "./backend";

const DEFAULT_TIMEOUT_MS = 60000; // Render cold start
const FRIENDLY_MESSAGE = "We're having trouble connecting right now. Please try again.";

/** Single user-facing error for all lease/processing failures. Never show backend URLs, CLI, or stack traces. */
export const USER_FACING_ERROR_MESSAGE =
  "We're having trouble processing this lease. Please review inputs or try again.";

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

const GATEWAY_STATUSES = new Set([502, 503, 504]);
const DEV_BACKEND_FALLBACKS = [
  "http://127.0.0.1:8010",
  "http://localhost:8010",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
];

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(id),
  };
}

function buildCandidateUrls(path: string): string[] {
  const primary = getApiUrl(path);
  if (process.env.NODE_ENV === "production") return [primary];
  const p = path.startsWith("/") ? path : `/${path}`;
  const urls = [primary];
  if (!primary.startsWith("/api")) urls.push(`/api${p}`);
  for (const base of DEV_BACKEND_FALLBACKS) {
    urls.push(`${base}${p}`);
  }
  return Array.from(new Set(urls));
}

/** Fetch with timeout; throws with friendly message on network error (no "Failed to fetch", no URLs). */
export async function fetchApi(
  path: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const candidates = buildCandidateUrls(path);

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    const isLast = i === candidates.length - 1;
    const timeout = withTimeoutSignal(timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: timeout.signal });
      timeout.clear();

      // In local dev, fail over from proxy/gateway errors to direct backend targets.
      if (process.env.NODE_ENV !== "production" && !isLast && GATEWAY_STATUSES.has(res.status)) {
        continue;
      }
      return res;
    } catch (e) {
      timeout.clear();
      if (isLast) {
        throw new Error(FRIENDLY_MESSAGE);
      }
    }
  }

  throw new Error(FRIENDLY_MESSAGE);
}
