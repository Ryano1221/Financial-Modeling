import { clearAccessToken, getAccessToken, setAccessToken } from "./auth-token";

const REFRESH_TOKEN_KEY = "thecremodel_supabase_refresh_token";
const USER_KEY = "thecremodel_supabase_user";

export interface SupabaseAuthUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface SupabaseAuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: SupabaseAuthUser;
}

function getEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return { url: url.replace(/\/+$/, ""), anonKey };
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function setStoredRefreshToken(token: string | undefined): void {
  if (!canUseStorage()) return;
  const clean = (token || "").trim();
  if (clean) window.localStorage.setItem(REFRESH_TOKEN_KEY, clean);
  else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  return raw?.trim() || null;
}

function setStoredUser(user: SupabaseAuthUser | null): void {
  if (!canUseStorage()) return;
  if (!user) {
    window.localStorage.removeItem(USER_KEY);
    return;
  }
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getStoredUser(): SupabaseAuthUser | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SupabaseAuthUser;
    if (!parsed?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function requestSupabase(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<Response> {
  const { url, anonKey } = getEnv();
  const headers = new Headers(init.headers || undefined);
  headers.set("apikey", anonKey);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return fetch(`${url}${path}`, {
    ...init,
    headers,
  });
}

function toSession(payload: Record<string, unknown>): SupabaseAuthSession {
  const access_token = String(payload.access_token || "").trim();
  const user = (payload.user as Record<string, unknown> | undefined) || {};
  const userId = String(user.id || "").trim();
  if (!access_token || !userId) {
    throw new Error("Supabase auth response did not include a valid session.");
  }
  const metadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const nameCandidate = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ].find((value) => typeof value === "string" && String(value).trim().length > 0);

  return {
    access_token,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expires_at: typeof payload.expires_at === "number" ? payload.expires_at : undefined,
    user: {
      id: userId,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof nameCandidate === "string" ? nameCandidate.trim() : null,
    },
  };
}

function persistSession(session: SupabaseAuthSession | null): void {
  if (!session) {
    clearAccessToken();
    setStoredRefreshToken(undefined);
    setStoredUser(null);
    return;
  }
  setAccessToken(session.access_token);
  setStoredRefreshToken(session.refresh_token);
  setStoredUser(session.user);
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<SupabaseAuthSession> {
  const res = await requestSupabase("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg =
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error === "string" && payload.error) ||
      "Sign in failed.";
    throw new Error(msg);
  }
  const session = toSession(payload);
  persistSession(session);
  return session;
}

export async function signUpWithPassword(
  email: string,
  password: string
): Promise<{ session: SupabaseAuthSession | null; needsEmailConfirmation: boolean }> {
  const res = await requestSupabase("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg =
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      "Sign up failed.";
    throw new Error(msg);
  }
  const hasSession = typeof payload.access_token === "string" && typeof payload.user === "object";
  if (!hasSession) {
    persistSession(null);
    return { session: null, needsEmailConfirmation: true };
  }
  const session = toSession(payload);
  persistSession(session);
  return { session, needsEmailConfirmation: false };
}

export async function signOut(): Promise<void> {
  const token = getAccessToken();
  if (token) {
    try {
      await requestSupabase("/auth/v1/logout", {
        method: "POST",
        token,
      });
    } catch {
      // Ignore; local cleanup still happens.
    }
  }
  persistSession(null);
}

export async function refreshSession(refreshToken: string): Promise<SupabaseAuthSession | null> {
  const clean = (refreshToken || "").trim();
  if (!clean) return null;
  const res = await requestSupabase("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: clean }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as Record<string, unknown>;
  const session = toSession(payload);
  persistSession(session);
  return session;
}

export async function getSession(): Promise<SupabaseAuthSession | null> {
  const token = getAccessToken();
  if (token) {
    const userRes = await requestSupabase("/auth/v1/user", { method: "GET", token });
    if (userRes.ok) {
      const userPayload = (await userRes.json()) as Record<string, unknown>;
      const userId = String(userPayload.id || "").trim();
      if (userId) {
        const metadata =
          userPayload.user_metadata && typeof userPayload.user_metadata === "object"
            ? (userPayload.user_metadata as Record<string, unknown>)
            : {};
        const nameCandidate = [
          metadata.full_name,
          metadata.name,
          metadata.display_name,
        ].find((value) => typeof value === "string" && String(value).trim().length > 0);
        const user: SupabaseAuthUser = {
          id: userId,
          email: typeof userPayload.email === "string" ? userPayload.email : null,
          name: typeof nameCandidate === "string" ? nameCandidate.trim() : null,
        };
        const refresh = getStoredRefreshToken() || undefined;
        const session: SupabaseAuthSession = { access_token: token, refresh_token: refresh, user };
        setStoredUser(user);
        return session;
      }
    }
  }

  const refresh = getStoredRefreshToken();
  if (refresh) {
    const refreshed = await refreshSession(refresh);
    if (refreshed) return refreshed;
  }

  const storedUser = getStoredUser();
  if (storedUser && token) {
    return { access_token: token, refresh_token: refresh || undefined, user: storedUser };
  }
  persistSession(null);
  return null;
}
