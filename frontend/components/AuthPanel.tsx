"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseAuthSession } from "@/lib/supabase";
import {
  consumeStoredAuthNotice,
  sendMagicLink,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/supabase";

interface AuthPanelProps {
  onAuthed: (session: SupabaseAuthSession) => void;
  initialMode?: "signin" | "signup";
}

export function AuthPanel({ onAuthed, initialMode = "signin" }: AuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    const hasPassword = mode === "signin" ? password.length > 0 : password.length >= 8;
    return !loading && !magicLinkLoading && email.trim().length > 3 && hasPassword;
  }, [email, password, loading, magicLinkLoading, mode]);

  const canSendMagicLink = useMemo(() => {
    return !loading && !magicLinkLoading && email.trim().length > 3;
  }, [email, loading, magicLinkLoading]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [mode]);

  useEffect(() => {
    const stored = consumeStoredAuthNotice();
    if (stored) {
      setError(stored);
    }
  }, []);
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

  async function sendEmailLink(): Promise<void> {
    if (!email.trim()) {
      setError("Enter your email address to receive a sign-in link.");
      return;
    }
    setMagicLinkLoading(true);
    setError(null);
    setNotice(null);
    try {
      await sendMagicLink(email.trim());
      setNotice("Check your email for a secure sign-in link. Open it on any device and you will be signed in there.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Unable to send a sign-in link right now.");
    } finally {
      setMagicLinkLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <section className="w-full max-w-md border border-white/20 bg-slate-950/80 p-6">
        <p className="heading-kicker mb-2">Account</p>
        <h1 className="heading-section mb-3">
          {mode === "signin" ? "Sign in to continue" : "Create your account"}
        </h1>
        <p className="text-sm text-slate-300 mb-5">
          {mode === "signin"
            ? "Your scenarios, branding, and PDF settings are scoped to your account. You can use your password or request an email sign-in link."
            : "Create a user account to save scenarios, branding, and PDF settings under your login."}
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            className={`btn-premium btn-premium-secondary ${mode === "signin" ? "" : "opacity-70"}`}
            onClick={() => setMode("signin")}
            disabled={loading || magicLinkLoading}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`btn-premium btn-premium-secondary ${mode === "signup" ? "" : "opacity-70"}`}
            onClick={() => setMode("signup")}
            disabled={loading || magicLinkLoading}
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
            placeholder={mode === "signin" ? "Enter your password" : "Minimum 8 characters"}
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

        {mode === "signin" && (
          <div className="mt-3 border border-white/10 bg-black/25 p-3">
            <p className="text-xs text-slate-400">No password handy or switching devices?</p>
            <button
              type="button"
              className={`btn-premium mt-3 w-full ${canSendMagicLink ? "btn-premium-primary" : "btn-premium-primary opacity-60"}`}
              disabled={!canSendMagicLink}
              onClick={() => {
                void sendEmailLink();
              }}
            >
              {magicLinkLoading ? "Sending secure sign-in link..." : "Email me a sign-in link"}
            </button>
          </div>
        )}

        {notice && <p className="mt-3 text-sm text-emerald-300">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>
    </main>
  );
}
