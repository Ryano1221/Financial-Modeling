/**
 * Backend base URL for all API calls (health, compute, extract, reports, etc.).
 * Uses BACKEND_URL from config (NEXT_PUBLIC_BACKEND_URL or default).
 */
import { BACKEND_URL } from "./config";

export const baseUrl = BACKEND_URL;

export type ApiHeaders = Record<string, string>;

/** Default JSON headers for API requests. */
export function getAuthHeaders(): ApiHeaders {
  return { "Content-Type": "application/json" };
}
