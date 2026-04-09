"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getPlatformModulesForMode,
  resolveActivePlatformModule,
} from "@/lib/platform/module-registry";
import { useBrokerOs } from "@/components/workspace/BrokerOsProvider";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { representationModeLabel } from "@/lib/workspace/representation-mode";

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
  const { graph } = useBrokerOs();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchParamsSnapshot = searchParams?.toString() || "";
  const selectedCrmCompanyId = asText(searchParams?.get("crm_company"));

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname, searchParamsSnapshot]);

  // Keep exported report and share routes presentation-only (no app chrome).
  const hideAppChrome = pathname?.startsWith("/report") || pathname?.endsWith("/share");

  const rawModule = String(searchParams?.get("module") || "").trim().toLowerCase();
  const hasExplicitModule = rawModule.length > 0;
  const platformModules = getPlatformModulesForMode(representationMode);
  const activeModule = hasExplicitModule
    ? resolveActivePlatformModule(rawModule, Boolean(session), representationMode)
    : null;
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
  const actualClientNameKeys = new Set(clients.map((client) => asText(client.name).toLowerCase()).filter(Boolean));
  const crmClientOptions = graph.companies
    .filter((company, index, list) => list.findIndex((item) => item.id === company.id) === index)
    .filter((company) => !actualClientNameKeys.has(asText(company.name).toLowerCase()))
    .sort((left, right) => asText(left.name).localeCompare(asText(right.name)));
  const clientDropdownValue = selectedCrmCompanyId
    ? `crm:${selectedCrmCompanyId}`
    : (activeClientId ? `client:${activeClientId}` : "");
  const switchWorkspaceClient = useCallback((clientId: string) => {
    const nextClientId = asText(clientId);
    if (!nextClientId) return;
    setActiveClient(nextClientId);
    const params = new URLSearchParams(searchParamsSnapshot);
    params.delete("crm_company");
    if (pathname === "/client" || pathname?.startsWith("/client/")) {
      router.push(`/client/${encodeURIComponent(nextClientId)}`);
      return;
    }
    const nextQuery = params.toString();
    if (nextQuery !== searchParamsSnapshot) {
      router.push(nextQuery ? `${pathname || "/"}?${nextQuery}` : (pathname || "/"));
    }
  }, [pathname, router, searchParamsSnapshot, setActiveClient]);
  const focusCrmClient = useCallback((companyId: string) => {
    const nextCompanyId = asText(companyId);
    if (!nextCompanyId) return;
    const params = new URLSearchParams(searchParamsSnapshot);
    params.set("module", "deals");
    params.set("crm_company", nextCompanyId);
    router.push(`/?${params.toString()}`);
  }, [router, searchParamsSnapshot]);

  if (hideAppChrome) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 print:hidden border-b border-white/20 bg-black/95 backdrop-blur-sm">
      <div className="app-container box-border max-w-full py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3 min-w-0">
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
              className="h-6 sm:h-7 xl:h-8 w-auto object-contain"
              priority
              sizes="(max-width: 640px) 112px, 140px"
            />
          </Link>
          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
            <button
              type="button"
              className="sm:hidden btn-premium btn-premium-secondary text-xs"
              aria-expanded={mobileMenuOpen}
              aria-controls="top-nav-mobile-menu"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
            >
              {mobileMenuOpen ? "Close" : "Menu"}
            </button>
            <div className="hidden sm:flex items-center gap-2 min-w-0 flex-1 justify-end">
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
              <div className="2xl:hidden min-w-[170px] max-w-[230px] shrink">
                <select
                  aria-label="Module navigation"
                  className="input-premium !h-9 !py-1.5 !text-xs"
                  value={activeModule || ""}
                  onChange={(event) => {
                    const moduleId = asText(event.target.value);
                    if (!moduleId) return;
                    router.push(`/?module=${encodeURIComponent(moduleId)}`);
                  }}
                >
                  <option value="">Select module</option>
                  {platformModules.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hidden 2xl:flex min-w-0 flex-1 justify-end">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto whitespace-nowrap pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {platformModules.map((tab) => {
                    const isActive = tab.id === activeModule;
                    return (
                      <Link
                        key={tab.id}
                        href={`/?module=${tab.id}`}
                        className={`btn-premium shrink-0 !min-h-8 !px-2 !py-1.5 text-[10px] xl:text-[11px] ${
                          isActive ? "btn-premium-primary" : "btn-premium-secondary"
                        }`}
                      >
                        {tab.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
              {ready && session ? (
                <select
                  aria-label="Active client workspace"
                  className="input-premium shrink-0 !h-8 !py-1 !text-[11px] w-[120px] lg:w-[132px] xl:w-[148px] 2xl:w-[190px]"
                  value={clientDropdownValue}
                  onChange={(event) => {
                    const rawValue = asText(event.target.value);
                    if (!rawValue) return;
                    if (rawValue.startsWith("crm:")) {
                      focusCrmClient(rawValue.slice(4));
                      return;
                    }
                    if (rawValue.startsWith("client:")) {
                      switchWorkspaceClient(rawValue.slice(7));
                    }
                  }}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={`client:${client.id}`}>
                      {truncateLabel(client.name, 30)}
                    </option>
                  ))}
                  {crmClientOptions.map((company) => (
                    <option key={`crm_${company.id}`} value={`crm:${company.id}`}>
                      {truncateLabel(company.name, 30)}
                    </option>
                  ))}
                </select>
              ) : null}
              {!ready ? null : session ? (
                <Link
                  href="/account"
                  className={`btn-premium shrink-0 !min-h-8 !px-2 !py-1.5 text-[10px] lg:text-[11px] ${
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
              {platformModules.map((tab) => {
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
              })}
              {ready && session ? (
                <select
                  aria-label="Active client workspace"
                  className="input-premium !text-xs"
                  value={clientDropdownValue}
                  onChange={(event) => {
                    const rawValue = asText(event.target.value);
                    if (!rawValue) return;
                    if (rawValue.startsWith("crm:")) {
                      focusCrmClient(rawValue.slice(4));
                      return;
                    }
                    if (rawValue.startsWith("client:")) {
                      switchWorkspaceClient(rawValue.slice(7));
                    }
                  }}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={`client:${client.id}`}>
                      {truncateLabel(client.name, 36)}
                    </option>
                  ))}
                  {crmClientOptions.map((company) => (
                    <option key={`crm_mobile_${company.id}`} value={`crm:${company.id}`}>
                      {truncateLabel(company.name, 36)}
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
