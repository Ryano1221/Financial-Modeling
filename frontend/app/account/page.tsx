"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { getSession, signOut, type SupabaseAuthSession } from "@/lib/supabase";

export default function AccountPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialMode = useMemo<"signin" | "signup">(
    () => (params.get("mode") === "signup" ? "signup" : "signin"),
    [params]
  );

  const [session, setSession] = useState<SupabaseAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <p className="text-sm text-slate-300">Loading account…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthPanel
        initialMode={initialMode}
        onAuthed={() => {
          router.push("/");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
      <section className="w-full max-w-md border border-white/20 bg-slate-950/80 p-6">
        <p className="heading-kicker mb-2">Account</p>
        <h1 className="heading-section mb-2">You are signed in</h1>
        <p className="text-sm text-slate-300 mb-5">{session.user.email || "Authenticated user"}</p>
        <div className="flex flex-col gap-2">
          <Link href="/" className="btn-premium btn-premium-secondary text-center">
            Go to dashboard
          </Link>
          <Link href="/branding" className="btn-premium btn-premium-secondary text-center">
            Branding settings
          </Link>
          <button
            type="button"
            className="btn-premium btn-premium-secondary"
            onClick={() =>
              void signOut().then(() => {
                setSession(null);
              })
            }
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
