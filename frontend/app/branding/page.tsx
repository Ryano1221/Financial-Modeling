"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthPanel } from "@/components/AuthPanel";
import { BrandingLogoUploader } from "@/components/BrandingLogoUploader";
import { getSession, signOut, type SupabaseAuthSession } from "@/lib/supabase";
import {
  deleteUserBrandingLogo,
  fetchUserBranding,
  type UserBrandingResponse,
  updateBrokerageName,
  uploadUserBrandingLogo,
} from "@/lib/user-settings";

export default function BrandingPage() {
  const [session, setSession] = useState<SupabaseAuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [branding, setBranding] = useState<UserBrandingResponse | null>(null);
  const [brokerageName, setBrokerageName] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const data = await fetchUserBranding();
      setBranding(data);
      setBrokerageName((data.brokerage_name || "").trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((next) => {
        if (cancelled) return;
        setSession(next);
      })
      .finally(() => {
        if (cancelled) return;
        setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  if (authLoading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <p className="text-sm text-slate-300">Loading account…</p>
      </main>
    );
  }

  if (!session) {
    return <AuthPanel onAuthed={(next) => setSession(next)} />;
  }

  return (
    <main className="min-h-screen bg-black text-white px-4 pt-24 sm:pt-28 pb-10">
      <section className="mx-auto w-full max-w-3xl border border-white/20 p-6 bg-slate-950/70">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <p className="heading-kicker mb-1">Branding</p>
            <h1 className="heading-section">Brokerage settings</h1>
          </div>
          <button
            type="button"
            className="btn-premium btn-premium-secondary"
            onClick={() => void signOut().then(() => setSession(null))}
          >
            Sign out
          </button>
        </div>

        <label className="block mb-4">
          <span className="text-xs text-slate-400">Brokerage name</span>
          <input
            type="text"
            value={brokerageName}
            onChange={(e) => setBrokerageName(e.target.value)}
            className="input-premium mt-1"
            placeholder="Your brokerage"
          />
        </label>
        <button
          type="button"
          className="btn-premium btn-premium-secondary"
          onClick={() =>
            void (async () => {
              setUploading(true);
              setError(null);
              try {
                await updateBrokerageName(brokerageName.trim());
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setUploading(false);
              }
            })()
          }
          disabled={uploading || loading}
        >
          Save brokerage
        </button>

        <BrandingLogoUploader
          branding={branding}
          loading={loading}
          uploading={uploading}
          error={error}
          onUpload={async (file) => {
            setUploading(true);
            setError(null);
            try {
              const data = await uploadUserBrandingLogo(file);
              setBranding(data);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setUploading(false);
            }
          }}
          onDelete={async () => {
            setUploading(true);
            setError(null);
            try {
              const data = await deleteUserBrandingLogo();
              setBranding(data);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setUploading(false);
            }
          }}
        />
      </section>
    </main>
  );
}
