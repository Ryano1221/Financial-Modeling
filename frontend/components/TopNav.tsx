"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  PLATFORM_MODULES,
  resolveActivePlatformModule,
} from "@/lib/platform/module-registry";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

function truncateLabel(value: string, maxChars: number): string {
  const clean = String(value || "").trim();
  if (!clean || clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}...`;
}

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    ready,
    session,
    activeClient,
    activeClientId,
    cloudSyncStatus,
    cloudSyncMessage,
    cloudLastSyncedAt,
  } = useClientWorkspace();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchParamsSnapshot = searchParams?.toString() || "";

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, searchParamsSnapshot]);

  // Keep exported report and share routes presentation-only (no app chrome).
  if (pathname?.startsWith("/report") || pathname?.endsWith("/share")) return null;

  const rawModule = String(searchParams?.get("module") || "").trim().toLowerCase();
  const hasExplicitModule = rawModule.length > 0;
  const activeModule = hasExplicitModule
    ? resolveActivePlatformModule(rawModule, Boolean(session))
    : null;
  const showModuleNav = pathname === "/";
  const clientHref = activeClientId ? `/client/${encodeURIComponent(activeClientId)}` : "/client";
  const clientLabel = activeClient ? `Client: ${truncateLabel(activeClient.name, 26)}` : "Client";
  const clientTabActive = pathname?.startsWith("/client");
  const syncTime =
    cloudLastSyncedAt && Number.isFinite(new Date(cloudLastSyncedAt).getTime())
      ? new Date(cloudLastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
  const cloudSyncLabel = (() => {
    if (!session) return "";
    if (cloudSyncStatus === "saving") return "Syncing...";
    if (cloudSyncStatus === "error") return "Sync error";
    if (cloudSyncStatus === "synced") return syncTime ? `Synced ${syncTime}` : "Synced";
    return "Cloud ready";
  })();
  const cloudSyncClass = cloudSyncStatus === "error"
    ? "text-red-300"
    : cloudSyncStatus === "saving"
      ? "text-amber-200"
      : "text-emerald-300";

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
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              className="sm:hidden btn-premium btn-premium-secondary text-xs"
              aria-expanded={mobileMenuOpen}
              aria-controls="top-nav-mobile-menu"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
            >
              {mobileMenuOpen ? "Close" : "Menu"}
            </button>
            <div className="hidden sm:flex flex-wrap items-center justify-end gap-2 min-w-0">
              {ready && session ? (
                <span
                  className={`hidden md:inline-flex text-[11px] uppercase tracking-[0.08em] ${cloudSyncClass}`}
                  title={cloudSyncMessage}
                >
                  {cloudSyncLabel}
                </span>
              ) : null}
              {showModuleNav
                ? PLATFORM_MODULES.map((tab) => {
                    const isActive = tab.id === activeModule;
                    return (
                      <Link
                        key={tab.id}
                        href={`/?module=${tab.id}`}
                        className={`btn-premium !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm ${
                          isActive ? "btn-premium-primary" : "btn-premium-secondary"
                        }`}
                      >
                        {tab.label}
                      </Link>
                    );
                  })
                : null}
              {ready && session ? (
                <Link
                  href={clientHref}
                  className={`btn-premium !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm ${
                    clientTabActive ? "btn-premium-primary" : "btn-premium-secondary"
                  }`}
                >
                  {clientLabel}
                </Link>
              ) : null}
              {!ready ? null : session ? (
                <Link href="/account" className="btn-premium btn-premium-secondary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
                  Account
                </Link>
              ) : (
                <>
                  <Link href="/account?mode=signin" className="btn-premium btn-premium-secondary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
                    Sign in
                  </Link>
                  <Link href="/account?mode=signup" className="btn-premium btn-premium-primary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
        {mobileMenuOpen ? (
          <div id="top-nav-mobile-menu" className="sm:hidden mt-3 border border-white/20 bg-black/95 p-2">
            <div className="grid grid-cols-1 gap-2">
              {ready && session ? (
                <div className={`px-2 py-1 text-[11px] uppercase tracking-[0.08em] ${cloudSyncClass}`} title={cloudSyncMessage}>
                  {cloudSyncLabel}
                </div>
              ) : null}
              {showModuleNav
                ? PLATFORM_MODULES.map((tab) => {
                    const isActive = tab.id === activeModule;
                    return (
                      <Link
                        key={tab.id}
                        href={`/?module=${tab.id}`}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`btn-premium text-xs ${
                          isActive ? "btn-premium-primary" : "btn-premium-secondary"
                        }`}
                      >
                        {tab.label}
                      </Link>
                    );
                  })
                : null}
              {ready && session ? (
                <Link
                  href={clientHref}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`btn-premium text-xs ${
                    clientTabActive ? "btn-premium-primary" : "btn-premium-secondary"
                  }`}
                >
                  {clientLabel}
                </Link>
              ) : null}
              {!ready ? null : session ? (
                <Link
                  href="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className="btn-premium btn-premium-secondary text-xs"
                >
                  Account
                </Link>
              ) : (
                <>
                  <Link
                    href="/account?mode=signin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-premium btn-premium-secondary text-xs"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/account?mode=signup"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-premium btn-premium-primary text-xs"
                  >
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
