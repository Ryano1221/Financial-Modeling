/**
 * Backend URL for API calls. Set NEXT_PUBLIC_BACKEND_URL in .env.local to override.
 */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8010";

if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_BACKEND_URL === undefined
) {
  console.warn(
    "[Lease Deck] NEXT_PUBLIC_BACKEND_URL is not set; using default:",
    BACKEND_URL
  );
}

export { BACKEND_URL };
