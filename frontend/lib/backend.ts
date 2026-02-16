/**
 * Single source of truth for backend base URL.
 * Production always uses same-origin /api so traffic flows through the website domain.
 * Development may use NEXT_PUBLIC_BACKEND_URL when provided.
 */
export function getBackendBaseUrl(): string {
  if (process.env.NODE_ENV === "production") return "";
  const v = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (!v) return ""; // same origin relative calls
  return v.endsWith("/") ? v.slice(0, -1) : v;
}
