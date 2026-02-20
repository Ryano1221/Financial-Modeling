const ACCESS_TOKEN_KEY = "thecremodel_supabase_access_token";

let inMemoryAccessToken: string | null = null;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function setAccessToken(token: string | null | undefined): void {
  const clean = typeof token === "string" ? token.trim() : "";
  inMemoryAccessToken = clean || null;
  if (!canUseStorage()) return;
  if (clean) {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, clean);
  } else {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function getAccessToken(): string | null {
  if (inMemoryAccessToken) return inMemoryAccessToken;
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  const clean = raw?.trim() || "";
  if (!clean) return null;
  inMemoryAccessToken = clean;
  return clean;
}

