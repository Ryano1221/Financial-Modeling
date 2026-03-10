"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, type SupabaseAuthSession } from "@/lib/supabase";

const moduleTabs = [
  {
    id: "financial-analyses",
    label: "Financial Analyses",
  },
  {
    id: "completed-leases",
    label: "Completed Leases",
  },
  {
    id: "surveys",
    label: "Surveys",
  },
  {
    id: "obligations",
    label: "Obligations",
  },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  }, [pathname]);
  // Keep exported report routes presentation-only (no app chrome).
  if (pathname?.startsWith("/report")) return null;

  const rawModule = String(searchParams?.get("module") || "").trim().toLowerCase();
  const activeModule = moduleTabs.some((tab) => tab.id === rawModule)
    ? rawModule
    : "financial-analyses";
  const showModuleNav = pathname === "/";

  return (
    <header className="fixed top-0 left-0 right-0 z-50 print:hidden border-b border-white/20 bg-black/95 backdrop-blur-sm">
      <div className="app-container py-3">
        <div className="flex items-center justify-between gap-3 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-3 shrink-0 min-w-0 rounded px-1 py-1 transition-colors"
            aria-label="TheCREmodel home"
          >
            <Image
              src="/brand/logo-white.svg"
              alt="The Commercial Real Estate Model logo"
              width={140}
              height={32}
              className="h-7 sm:h-8 w-auto object-contain"
              priority
              sizes="(max-width: 640px) 112px, 140px"
            />
          </Link>
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto whitespace-nowrap">
            {showModuleNav
              ? moduleTabs.map((tab) => {
                  const isActive = tab.id === activeModule;
                  return (
                    <Link
                      key={tab.id}
                      href={`/?module=${tab.id}`}
                      className={`btn-premium text-xs sm:text-sm ${
                        isActive ? "btn-premium-primary" : "btn-premium-secondary"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  );
                })
              : null}
            {authLoading ? null : session ? (
              <Link href="/account" className="btn-premium btn-premium-secondary text-xs sm:text-sm">
                Account
              </Link>
            ) : (
              <>
                <Link href="/account?mode=signin" className="btn-premium btn-premium-secondary text-xs sm:text-sm">
                  Sign in
                </Link>
                <Link href="/account?mode=signup" className="btn-premium btn-premium-primary text-xs sm:text-sm">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
