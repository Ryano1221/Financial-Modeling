/**
 * Single source of truth for base URLs.
 * Production should set NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_SITE_URL (Ryan's domain).
 */

const RENDER_BACKEND = "https://financial-modeling-docker.onrender.com";

/**
 * API base URL (no trailing slash).
 * 1. NEXT_PUBLIC_API_BASE_URL if set
 * 2. NEXT_PUBLIC_BACKEND_URL if set (legacy)
 * 3. In browser: if origin is localhost/127.0.0.1 use Render backend; else same origin
 * 4. Fallback: Render backend
 */
export function getApiBaseUrl(): string {
  const envApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (envApi) return envApi.endsWith("/") ? envApi.slice(0, -1) : envApi;
  const envBackend = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (envBackend) return envBackend.endsWith("/") ? envBackend.slice(0, -1) : envBackend;
  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (/localhost|127\.0\.0\.1/.test(origin)) return RENDER_BACKEND;
    return origin;
  }
  return RENDER_BACKEND;
}

/**
 * Site URL for absolute links and callbacks (no trailing slash).
 * Use NEXT_PUBLIC_SITE_URL in production (e.g. https://thecremodel.com).
 */
export function getSiteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.endsWith("/") ? env.slice(0, -1) : env;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
