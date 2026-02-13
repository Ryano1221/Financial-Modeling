/**
 * Single source of truth for backend base URL.
 * Set NEXT_PUBLIC_BACKEND_URL in the environment (e.g. Vercel, .env.local).
 * When unset, returns "" for same-origin relative calls (e.g. /api/...).
 */
export function getBackendBaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!v) return ""; // same origin relative calls
  return v.endsWith("/") ? v.slice(0, -1) : v;
}
