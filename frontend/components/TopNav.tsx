"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { representationModeLabel } from "@/lib/workspace/representation-mode";
import {
  getPrimaryWorkspaceNavForMode,
  resolveNavToWorkspaceTab,
  resolveWorkspaceTab,
} from "@/lib/platform/workspace-navigation";

function truncateLabel(value: string, maxChars: number): string {
  const clean = String(value || "").trim();
  if (!clean || clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}...`;
}

function asText(value: unknown): string {
  return String(value || "").trim();
}

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    ready,
    session,
    representationMode,
    clients,
    activeClientId,
    setActiveClient,
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

  const rawWorkspace = String(searchParams?.get("workspace") || "").trim().toLowerCase();
  const rawNav = String(searchParams?.get("nav") || "").trim().toLowerCase();
  const primaryNavItems = getPrimaryWorkspaceNavForMode(representationMode);
  const activeWorkspaceTab = resolveWorkspaceTab(rawWorkspace, representationMode);
  const navTargetTab = resolveNavToWorkspaceTab(rawNav, representationMode);
  const activeNavId =
    primaryNavItems.find((item) => item.targetTab === (navTargetTab || activeWorkspaceTab))?.id || primaryNavItems[0]?.id;
  const accountTabActive = pathname?.startsWith("/account");
  const syncTime =
    cloudLastSyncedAt && Number.isFinite(new Date(cloudLastSyncedAt).getTime())
      ? new Date(cloudLastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
  const cloudSyncLabel = (() => {
    if (!session) return "";
    if (cloudSyncStatus === "saving") return "Syncing...";
    if (cloudSyncStatus === "error") return "Sync error";
    if (cloudSyncStatus === "local") return "Local mode";
    if (cloudSyncStatus === "synced") return syncTime ? `Synced ${syncTime}` : "Synced";
    return "Cloud ready";
  })();
  const cloudSyncClass = cloudSyncStatus === "error"
    ? "text-red-300"
    : cloudSyncStatus === "saving" || cloudSyncStatus === "local"
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
            <div className="hidden sm:flex flex-nowrap items-center gap-2 min-w-0 ml-auto whitespace-nowrap [&>*]:shrink-0">
              {ready && session ? (
                <span
                  className={`hidden 2xl:inline-flex text-[11px] uppercase tracking-[0.08em] ${cloudSyncClass}`}
                  title={cloudSyncMessage}
                >
                  {cloudSyncLabel}
                </span>
              ) : null}
              {ready && session ? (
                <span className="hidden 2xl:inline-flex text-[11px] uppercase tracking-[0.08em] text-slate-300">
                  {representationMode ? representationModeLabel(representationMode) : "Mode Required"}
                </span>
              ) : null}
              <div className="lg:hidden min-w-[190px]">
                <select
                  aria-label="Workspace navigation"
                  className="input-premium !h-9 !py-1.5 !text-xs"
                  value={activeNavId || ""}
                  onChange={(event) => {
                    const navId = asText(event.target.value);
                    const item = primaryNavItems.find((entry) => entry.id === navId);
                    if (!item) return;
                    router.push(`/?nav=${encodeURIComponent(item.id)}&workspace=${encodeURIComponent(item.targetTab)}`);
                  }}
                >
                  <option value="">Open workspace</option>
                  {primaryNavItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hidden lg:flex items-center gap-2">
                {primaryNavItems.map((item) => {
                  const isActive = item.id === activeNavId;
                  return (
                    <Link
                      key={item.id}
                      href={`/?nav=${item.id}&workspace=${item.targetTab}`}
                      className={`btn-premium !min-h-8 !px-2 !py-1.5 text-[10px] lg:text-[11px] ${
                        isActive ? "btn-premium-primary" : "btn-premium-secondary"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              {ready && session ? (
                <select
                  aria-label="Active workspace"
                  className="input-premium !h-8 !py-1 !text-[11px] max-w-[160px] xl:max-w-[190px]"
                  value={activeClientId || ""}
                  onChange={(event) => {
                    const clientId = asText(event.target.value);
                    if (!clientId) return;
                    setActiveClient(clientId);
                  }}
                >
                  <option value="" disabled>
                    Select workspace
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {truncateLabel(client.name, 30)}
                    </option>
                  ))}
                </select>
              ) : null}
              {!ready ? null : session ? (
                <Link
                  href="/account"
                  className={`btn-premium !min-h-8 !px-2 !py-1.5 text-[10px] lg:text-[11px] ${
                    accountTabActive ? "btn-premium-primary" : "btn-premium-secondary"
                  }`}
                >
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
              {primaryNavItems.map((item) => {
                const isActive = item.id === activeNavId;
                return (
                  <Link
                    key={item.id}
                    href={`/?nav=${item.id}&workspace=${item.targetTab}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`btn-premium text-xs ${
                      isActive ? "btn-premium-primary" : "btn-premium-secondary"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {ready && session ? (
                <select
                  aria-label="Active workspace"
                  className="input-premium !text-xs"
                  value={activeClientId || ""}
                  onChange={(event) => {
                    const clientId = asText(event.target.value);
                    if (!clientId) return;
                    setActiveClient(clientId);
                  }}
                >
                  <option value="" disabled>
                    Select workspace
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {truncateLabel(client.name, 36)}
                    </option>
                  ))}
                </select>
              ) : null}
              {!ready ? null : session ? (
                <Link
                  href="/account"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`btn-premium text-xs ${
                    accountTabActive ? "btn-premium-primary" : "btn-premium-secondary"
                  }`}
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
