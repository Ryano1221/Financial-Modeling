"use client";

import { useMemo, useState } from "react";
import type { SupabaseAuthSession } from "@/lib/supabase";
import { signInWithPassword, signUpWithPassword } from "@/lib/supabase";

interface AuthPanelProps {
  onAuthed: (session: SupabaseAuthSession) => void;
}

export function AuthPanel({ onAuthed }: AuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return !loading && email.trim().length > 3 && password.length >= 8;
  }, [email, password, loading]);

  async function submit(): Promise<void> {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const session = await signInWithPassword(email.trim(), password);
        onAuthed(session);
      } else {
        const result = await signUpWithPassword(email.trim(), password);
        if (result.session) {
          onAuthed(result.session);
        } else {
          setNotice("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <section className="w-full max-w-md border border-white/20 bg-slate-950/80 p-6">
        <p className="heading-kicker mb-2">Account</p>
        <h1 className="heading-section mb-3">Sign in to continue</h1>
        <p className="text-sm text-slate-300 mb-5">
          Your scenarios, branding, and PDF settings are scoped to your account.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            className={`btn-premium btn-premium-secondary ${mode === "signin" ? "" : "opacity-70"}`}
            onClick={() => setMode("signin")}
            disabled={loading}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`btn-premium btn-premium-secondary ${mode === "signup" ? "" : "opacity-70"}`}
            onClick={() => setMode("signup")}
            disabled={loading}
          >
            Sign up
          </button>
        </div>

        <label className="block mb-3">
          <span className="text-xs text-slate-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-premium mt-1"
            placeholder="you@company.com"
            autoComplete="email"
          />
        </label>

        <label className="block mb-4">
          <span className="text-xs text-slate-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-premium mt-1"
            placeholder="Minimum 8 characters"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>

        <button
          type="button"
          className="btn-premium btn-premium-secondary w-full"
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>
    </main>
  );
}
