/**
 * Backend URL for API calls. Re-exports from single source of truth (lib/backend.ts).
 * No localhost default: when unset, use same-origin /api (see getApiUrl in lib/api.ts).
 */
import { getBackendBaseUrl } from "./backend";

export const BACKEND_URL = getBackendBaseUrl();
