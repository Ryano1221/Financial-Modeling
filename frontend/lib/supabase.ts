import { clearAccessToken, getAccessToken, setAccessToken } from "./auth-token";
import { AUTH_SESSION_COOKIE } from "./auth-access";

const REFRESH_TOKEN_KEY = "thecremodel_supabase_refresh_token";
const USER_KEY = "thecremodel_supabase_user";
const SESSION_LAST_ACTIVE_AT_KEY = "thecremodel_supabase_session_last_active_at";
const AUTH_NOTICE_KEY = "thecremodel_supabase_auth_notice";
export const AUTH_SESSION_MAX_AGE_DAYS = 30;
const MAX_PERSIST_AGE_MS = AUTH_SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const AUTH_CALLBACK_KEYS = [
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "token_type",
  "type",
  "token_hash",
  "error",
  "error_code",
  "error_description",
] as const;

export interface SupabaseAuthUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  team?: string | null;
}

export interface SupabaseAuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: SupabaseAuthUser;
}

export interface UpdatePersonalInfoInput {
  name?: string;
  email?: string;
  password?: string;
}

export interface UpdatePersonalInfoResult {
  user: SupabaseAuthUser;
  emailConfirmationRequired: boolean;
}

type SessionListener = (session: SupabaseAuthSession | null) => void;
const sessionListeners = new Set<SessionListener>();

function emitSession(session: SupabaseAuthSession | null): void {
  sessionListeners.forEach((listener) => {
    try {
      listener(session);
    } catch {
      // Ignore subscriber exceptions so auth persistence is not blocked.
    }
  });
}

export function subscribeAuthSession(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function getEnv(): { url: string; anonKey: string } {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const envAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const url = envUrl;
  const anonKey = envAnonKey;
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

function canUseHistory(): boolean {
  return typeof window !== "undefined" && typeof window.history !== "undefined";
}

function syncAuthSessionCookie(isAuthenticated: boolean): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  if (isAuthenticated) {
    document.cookie = `${AUTH_SESSION_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = `${AUTH_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
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

function setStoredAuthNotice(message: string | null): void {
  if (!canUseStorage()) return;
  const clean = String(message || "").trim();
  if (clean) {
    window.localStorage.setItem(AUTH_NOTICE_KEY, clean);
    return;
  }
  window.localStorage.removeItem(AUTH_NOTICE_KEY);
}

export function consumeStoredAuthNotice(): string | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(AUTH_NOTICE_KEY);
  if (raw) window.localStorage.removeItem(AUTH_NOTICE_KEY);
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

function setStoredSessionLastActiveAt(value: number | null): void {
  if (!canUseStorage()) return;
  if (!value || !Number.isFinite(value) || value <= 0) {
    window.localStorage.removeItem(SESSION_LAST_ACTIVE_AT_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_LAST_ACTIVE_AT_KEY, String(Math.floor(value)));
}

function getStoredSessionLastActiveAt(): number | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(SESSION_LAST_ACTIVE_AT_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function isPersistedSessionExpired(): boolean {
  const ts = getStoredSessionLastActiveAt();
  if (!ts) return false;
  return (Date.now() - ts) > MAX_PERSIST_AGE_MS;
}

function shouldDropPersistedSession(): boolean {
  return isPersistedSessionExpired();
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

function toUser(payload: Record<string, unknown>): SupabaseAuthUser {
  const userId = String(payload.id || "").trim();
  if (!userId) {
    throw new Error("Supabase auth response did not include a valid user.");
  }
  const metadata =
    payload.user_metadata && typeof payload.user_metadata === "object"
      ? (payload.user_metadata as Record<string, unknown>)
      : {};
  const nameCandidate = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ].find((value) => typeof value === "string" && String(value).trim().length > 0);
  const roleCandidate = [
    metadata.role,
    metadata.user_role,
    metadata.org_role,
  ].find((value) => typeof value === "string" && String(value).trim().length > 0);
  const teamCandidate = [
    metadata.team,
    metadata.team_name,
    metadata.broker_team,
    metadata.org_name,
  ].find((value) => typeof value === "string" && String(value).trim().length > 0);

  return {
    id: userId,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof nameCandidate === "string" ? nameCandidate.trim() : null,
    role: typeof roleCandidate === "string" ? roleCandidate.trim() : null,
    team: typeof teamCandidate === "string" ? teamCandidate.trim() : null,
  };
}

async function fetchUserForAccessToken(token: string): Promise<SupabaseAuthUser> {
  const clean = String(token || "").trim();
  if (!clean) {
    throw new Error("Missing access token.");
  }
  const userRes = await requestSupabase("/auth/v1/user", { method: "GET", token: clean });
  const text = await userRes.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!userRes.ok) {
    const msg =
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      "Unable to restore authenticated session.";
    throw new Error(msg);
  }
  return toUser(payload);
}

function toSession(payload: Record<string, unknown>): SupabaseAuthSession {
  const access_token = String(payload.access_token || "").trim();
  const userPayload = (payload.user as Record<string, unknown> | undefined) || {};
  if (!access_token || !userPayload.id) {
    throw new Error("Supabase auth response did not include a valid session.");
  }

  return {
    access_token,
    refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expires_at: typeof payload.expires_at === "number" ? payload.expires_at : undefined,
    user: toUser(userPayload),
  };
}

function buildAuthRedirectUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "";
  const base = siteUrl || (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) {
    throw new Error("Auth redirect URL is not configured.");
  }
  return new URL("/sign-in", base).toString();
}

function normalizeAuthRedirectType(raw: string | null): string | null {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "magiclink" || value === "signup") return "email";
  return value;
}

function clearAuthParamsFromUrl(): void {
  if (!canUseHistory()) return;
  const url = new URL(window.location.href);
  AUTH_CALLBACK_KEYS.forEach((key) => {
    url.searchParams.delete(key);
  });
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  AUTH_CALLBACK_KEYS.forEach((key) => {
    hashParams.delete(key);
  });
  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl);
}

export async function sendMagicLink(email: string): Promise<void> {
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) {
    throw new Error("Enter your email address to receive a sign-in link.");
  }
  const redirectTo = buildAuthRedirectUrl();
  const res = await requestSupabase("/auth/v1/otp", {
    method: "POST",
    body: JSON.stringify({
      email: cleanEmail,
      create_user: true,
      email_redirect_to: redirectTo,
      options: {
        email_redirect_to: redirectTo,
      },
    }),
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg =
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      "Unable to send a sign-in link right now.";
    throw new Error(msg);
  }
}

export async function consumeAuthRedirectSession(): Promise<SupabaseAuthSession | null> {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const queryParams = url.searchParams;
  const errorMessage =
    hashParams.get("error_description") ||
    queryParams.get("error_description") ||
    hashParams.get("error") ||
    queryParams.get("error");

  if (errorMessage) {
    setStoredAuthNotice(errorMessage);
    clearAuthParamsFromUrl();
    return null;
  }

  const accessToken = hashParams.get("access_token") || queryParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") || queryParams.get("refresh_token") || undefined;
  const expiresAtRaw = hashParams.get("expires_at") || queryParams.get("expires_at");

  if (accessToken) {
    try {
      const user = await fetchUserForAccessToken(accessToken);
      const expiresAt = Number(expiresAtRaw);
      const session: SupabaseAuthSession = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Number.isFinite(expiresAt) ? expiresAt : undefined,
        user,
      };
      persistSession(session);
      clearAuthParamsFromUrl();
      setStoredAuthNotice(null);
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "That sign-in link is invalid or expired.";
      setStoredAuthNotice(message);
      clearAuthParamsFromUrl();
      persistSession(null);
      return null;
    }
  }

  const tokenHash = queryParams.get("token_hash") || hashParams.get("token_hash");
  const type = normalizeAuthRedirectType(queryParams.get("type") || hashParams.get("type"));
  if (tokenHash && type) {
    const res = await requestSupabase("/auth/v1/verify", {
      method: "POST",
      body: JSON.stringify({
        token_hash: tokenHash,
        type,
      }),
    });
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const msg =
        (typeof payload.msg === "string" && payload.msg) ||
        (typeof payload.error_description === "string" && payload.error_description) ||
        (typeof payload.error === "string" && payload.error) ||
        "That sign-in link is invalid or expired.";
      setStoredAuthNotice(msg);
      clearAuthParamsFromUrl();
      return null;
    }
    const session = toSession(payload);
    persistSession(session);
    clearAuthParamsFromUrl();
    setStoredAuthNotice(null);
    return session;
  }

  return null;
}

function persistSession(session: SupabaseAuthSession | null): void {
  if (!session) {
    clearAccessToken();
    setStoredRefreshToken(undefined);
    setStoredUser(null);
    setStoredSessionLastActiveAt(null);
    syncAuthSessionCookie(false);
    emitSession(null);
    return;
  }
  setAccessToken(session.access_token);
  setStoredRefreshToken(session.refresh_token);
  setStoredUser(session.user);
  setStoredSessionLastActiveAt(Date.now());
  syncAuthSessionCookie(true);
  emitSession(session);
}

export function getSessionFromStorage(): SupabaseAuthSession | null {
  const token = getAccessToken();
  const user = getStoredUser();
  if (!token || !user) return null;
  if (shouldDropPersistedSession()) return null;
  const refresh = getStoredRefreshToken() || undefined;
  syncAuthSessionCookie(true);
  return {
    access_token: token,
    refresh_token: refresh,
    user,
  };
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

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

function buildPersonalInfoUpdateBody(input: UpdatePersonalInfoInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const name = typeof input.name === "string" ? input.name.trim() : undefined;
  const email = typeof input.email === "string" ? input.email.trim() : undefined;
  const password = typeof input.password === "string" ? input.password : undefined;

  if (typeof name === "string") {
    if (!name) throw new Error("Enter your name before saving.");
    body.data = {
      full_name: name,
      name,
      display_name: name,
    };
  }
  if (typeof email === "string") {
    if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
    body.email = email;
  }
  if (typeof password === "string") {
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    body.password = password;
  }
  if (Object.keys(body).length === 0) {
    throw new Error("Change your name, email, or password before saving.");
  }
  return body;
}

export async function updatePersonalInfo(input: UpdatePersonalInfoInput): Promise<UpdatePersonalInfoResult> {
  let token = getAccessToken();
  if (!token) {
    throw new Error("Sign in again before updating personal info.");
  }

  const body = buildPersonalInfoUpdateBody(input);
  const doUpdate = (nextToken: string) => requestSupabase("/auth/v1/user", {
    method: "PUT",
    token: nextToken,
    body: JSON.stringify(body),
  });

  let res = await doUpdate(token);
  if (isAuthFailure(res.status)) {
    const refreshed = await refreshPersistedSession();
    if (refreshed?.access_token) {
      token = refreshed.access_token;
      res = await doUpdate(token);
    }
  }

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const msg =
      (typeof payload.msg === "string" && payload.msg) ||
      (typeof payload.error_description === "string" && payload.error_description) ||
      (typeof payload.error === "string" && payload.error) ||
      "Unable to update personal info.";
    throw new Error(msg);
  }

  const returnedUser = toUser(payload);
  const previousUser = getStoredUser();
  const requestedEmail = typeof input.email === "string" ? input.email.trim() : "";
  const mergedUser: SupabaseAuthUser = {
    ...(previousUser || returnedUser),
    ...returnedUser,
    email: returnedUser.email || previousUser?.email || null,
  };
  const nextSession: SupabaseAuthSession = {
    access_token: token,
    refresh_token: getStoredRefreshToken() || undefined,
    user: mergedUser,
  };
  persistSession(nextSession);

  return {
    user: mergedUser,
    emailConfirmationRequired: Boolean(requestedEmail && requestedEmail.toLowerCase() !== String(mergedUser.email || "").toLowerCase()),
  };
}

export async function refreshSession(refreshToken: string): Promise<SupabaseAuthSession | null> {
  const clean = (refreshToken || "").trim();
  if (!clean) return null;
  if (shouldDropPersistedSession()) {
    persistSession(null);
    return null;
  }
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

export async function refreshPersistedSession(): Promise<SupabaseAuthSession | null> {
  if (shouldDropPersistedSession()) {
    persistSession(null);
    return null;
  }
  const refresh = getStoredRefreshToken();
  if (!refresh) return null;
  return refreshSession(refresh);
}

export async function getSession(): Promise<SupabaseAuthSession | null> {
  const redirected = await consumeAuthRedirectSession();
  if (redirected) {
    return redirected;
  }
  if (shouldDropPersistedSession()) {
    persistSession(null);
    return null;
  }
  const token = getAccessToken();
  let userLookupFailed = false;
  let tokenRejected = false;

  if (token) {
    try {
      const userRes = await requestSupabase("/auth/v1/user", { method: "GET", token });
      if (userRes.ok) {
        const userPayload = (await userRes.json()) as Record<string, unknown>;
        if (userPayload.id) {
          const user = toUser(userPayload);
          const refresh = getStoredRefreshToken() || undefined;
          const session: SupabaseAuthSession = { access_token: token, refresh_token: refresh, user };
          setStoredUser(user);
          setStoredSessionLastActiveAt(Date.now());
          syncAuthSessionCookie(true);
          return session;
        }
      }
      if (userRes.status === 401 || userRes.status === 403) {
        tokenRejected = true;
      } else {
        userLookupFailed = true;
      }
    } catch {
      userLookupFailed = true;
    }
  }

  const refresh = getStoredRefreshToken();
  if (refresh) {
    const refreshed = await refreshSession(refresh);
    if (refreshed) return refreshed;
  }

  const storedUser = getStoredUser();
  if (storedUser && token && userLookupFailed && !tokenRejected) {
    setStoredSessionLastActiveAt(Date.now());
    syncAuthSessionCookie(true);
    return { access_token: token, refresh_token: refresh || undefined, user: storedUser };
  }
  if (storedUser && token && !shouldDropPersistedSession()) {
    setStoredSessionLastActiveAt(Date.now());
    syncAuthSessionCookie(true);
    return { access_token: token, refresh_token: refresh || undefined, user: storedUser };
  }
  persistSession(null);
  return null;
}
