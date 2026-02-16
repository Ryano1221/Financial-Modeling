/**
 * Backend base URL: NEXT_PUBLIC_BACKEND_URL (no trailing slash).
 * Required for all environments; browser calls Render directly (no Vercel proxy).
 */
export function getBackendBaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ?? "";
  const url = v.endsWith("/") ? v.slice(0, -1) : v;
  if (!url) {
    throw new Error("NEXT_PUBLIC_BACKEND_URL is not set. Set it in Vercel (or .env.local) to your Render backend URL.");
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
/** Log resolved backend base URL once on page load (dev only). Call from a client component on mount. */
export function logBackendBaseUrlOnce(): void {
  if (_logged) return;
  _logged = true;
  const url = getBackendBaseUrlForDisplay();
  console.log("[backend] NEXT_PUBLIC_BACKEND_URL resolved:", url);
}
