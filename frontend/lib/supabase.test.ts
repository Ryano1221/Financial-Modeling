import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

describe("supabase auth helpers", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.NEXT_PUBLIC_SITE_URL = "https://thecremodel.com";
  });

  afterEach(async () => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    if (typeof originalSupabaseUrl === "string") process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (typeof originalSupabaseAnonKey === "string") process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
    else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (typeof originalSiteUrl === "string") process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    else delete process.env.NEXT_PUBLIC_SITE_URL;
    const authToken = await import("@/lib/auth-token");
    authToken.clearAccessToken();
  });

  it("keeps an expired persisted session when a refresh token exists", async () => {
    const storage = new MemoryStorage();
    const now = Date.now();
    const stale = now - (31 * 24 * 60 * 60 * 1000);
    storage.setItem("thecremodel_supabase_access_token", "access-token");
    storage.setItem("thecremodel_supabase_refresh_token", "refresh-token");
    storage.setItem("thecremodel_supabase_user", JSON.stringify({ id: "user-1", email: "user@example.com" }));
    storage.setItem("thecremodel_supabase_session_last_active_at", String(stale));

    globalThis.window = {
      localStorage: storage,
    } as Window & typeof globalThis;

    const supabase = await import("@/lib/supabase");
    const session = supabase.getSessionFromStorage();

    expect(session?.access_token).toBe("access-token");
    expect(session?.refresh_token).toBe("refresh-token");
    expect(session?.user.id).toBe("user-1");
  });

  it("consumes a magic-link style redirect and persists the session", async () => {
    const storage = new MemoryStorage();
    let replacedUrl = "";

    globalThis.window = {
      localStorage: storage,
      location: {
        href: "https://thecremodel.com/account?mode=signin#access_token=access-token&refresh_token=refresh-token&expires_at=1999999999&type=magiclink",
        origin: "https://thecremodel.com",
      },
      history: {
        replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
          replacedUrl = String(url || "");
        },
      },
    } as Window & typeof globalThis;
    globalThis.document = { title: "Account" } as Document;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return new Response(
          JSON.stringify({
            id: "user-42",
            email: "broker@example.com",
            user_metadata: { full_name: "Broker User", team: "Broker Team" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const supabase = await import("@/lib/supabase");
    const session = await supabase.consumeAuthRedirectSession();

    expect(session?.access_token).toBe("access-token");
    expect(session?.refresh_token).toBe("refresh-token");
    expect(session?.user.email).toBe("broker@example.com");
    expect(storage.getItem("thecremodel_supabase_access_token")).toBe("access-token");
    expect(storage.getItem("thecremodel_supabase_refresh_token")).toBe("refresh-token");
    expect(replacedUrl).toBe("/account?mode=signin");
  });
});
