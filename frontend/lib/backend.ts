import { getApiBaseUrl, getSiteUrl } from "./env";

/**
 * Backend base URL (no trailing slash). Uses getApiBaseUrl from env.ts.
 * Set NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_BACKEND_URL in production.
 */
export function getBackendBaseUrl(): string {
  const url = getApiBaseUrl();
  if (!url) {
    throw new Error("API base URL is not set. Set NEXT_PUBLIC_API_BASE_URL or NEXT_PUBLIC_BACKEND_URL in Vercel (or .env.local).");
  }
  return url;
}

/** Safe for display; returns "[not set]" if unset. */
export function getBackendBaseUrlForDisplay(): string {
  try {
    return getBackendBaseUrl();
  } catch {
    return "[not set]";
  }
}

let _logged = false;
/** Log resolved API and site URLs once on page load. Call from a client component on mount. */
export function logResolvedUrlsOnce(): void {
  if (_logged) return;
  _logged = true;
  const api = getBackendBaseUrlForDisplay();
  const site = getSiteUrl() || "[not set]";
  console.log("RESOLVED_API_BASE_URL", api);
  console.log("RESOLVED_SITE_URL", site);
}
