/**
 * Backend URL for API calls. Re-exports from lib/backend.ts (NEXT_PUBLIC_BACKEND_URL).
 * Required; throws if unset.
 */
import { getBackendBaseUrl } from "./backend";

export const BACKEND_URL = getBackendBaseUrl();
