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
