"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getPlatformModulesForMode,
  resolveActivePlatformModule,
} from "@/lib/platform/module-registry";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";
import { representationModeLabel } from "@/lib/workspace/representation-mode";
import { useCrmProfileOptions } from "@/lib/workspace/crm-profile-options";

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
  } = useClientWorkspace();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchParamsSnapshot = searchParams?.toString() || "";
  const navLocked = !session;

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
  const isCrmModule = activeModule === "deals";
  const crmProfileOptions = useCrmProfileOptions(activeClientId, Boolean(ready && session && isCrmModule));
  const selectedCrmCompanyId = asText(searchParams?.get("crm_company"));
  const accountTabActive = pathname?.startsWith("/account");
  const clientDropdownValue = isCrmModule && crmProfileOptions.length > 0
    ? `crm:${selectedCrmCompanyId && crmProfileOptions.some((company) => company.id === selectedCrmCompanyId) ? selectedCrmCompanyId : crmProfileOptions[0]?.id || ""}`
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

  const focusCrmCompany = useCallback((companyId: string) => {
    const nextCompanyId = asText(companyId);
    if (!nextCompanyId) return;
    const params = new URLSearchParams(searchParamsSnapshot);
    params.set("module", "deals");
    params.set("crm_company", nextCompanyId);
    router.push(`/?${params.toString()}`);
  }, [router, searchParamsSnapshot]);

  const handleClientDropdownChange = useCallback((rawValue: string) => {
    const value = asText(rawValue);
    if (!value) return;
    if (value.startsWith("crm:")) {
      focusCrmCompany(value.slice(4));
      return;
    }
    if (value.startsWith("client:")) {
      switchWorkspaceClient(value.slice(7));
    }
  }, [focusCrmCompany, switchWorkspaceClient]);

  if (hideAppChrome) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 print:hidden border-b border-white/20 bg-black/95 backdrop-blur-sm">
      <div className="app-container box-border max-w-full py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-3 min-w-0">
          <Link
            href="/"
            className="flex min-w-0 shrink-0 items-center rounded px-1 py-1 transition-colors"
            aria-label="TheCREmodel home"
          >
            <div className="brand-lockup">
              <Image
                src="/brand/logo-white.svg"
                alt="TheCREmodel"
                width={148}
                height={31}
                className="brand-wordmark"
                priority
              />
              <span className="brand-subtext truncate">
                Commercial Real Estate Intelligence
              </span>
            </div>
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
                <span className="hidden 2xl:inline-flex text-[11px] uppercase tracking-[0.08em] text-slate-300">
                  {representationMode ? representationModeLabel(representationMode) : "Mode Required"}
                </span>
              ) : null}
              <div className={`2xl:hidden min-w-[170px] max-w-[230px] shrink ${navLocked ? "pointer-events-none opacity-40" : ""}`}>
                <select
                  aria-label="Module navigation"
                  className="input-premium !h-9 !py-1.5 !text-xs"
                  disabled={navLocked}
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
              <div className={`hidden 2xl:flex min-w-0 flex-1 justify-end ${navLocked ? "pointer-events-none opacity-40" : ""}`}>
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
                  onChange={(event) => handleClientDropdownChange(event.target.value)}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {isCrmModule && crmProfileOptions.length > 0
                    ? crmProfileOptions.map((company) => (
                      <option key={company.id} value={`crm:${company.id}`}>
                        {truncateLabel(company.name, 30)}
                      </option>
                    ))
                    : clients.map((client) => (
                      <option key={client.id} value={`client:${client.id}`}>
                        {truncateLabel(client.name, 30)}
                      </option>
                    ))}
                </select>
              ) : null}
              {!ready ? null : session ? (
                <>
                  <Link
                    href="/pricing"
                    className="btn-premium shrink-0 !min-h-8 !px-2 !py-1.5 text-[10px] lg:text-[11px] btn-premium-secondary"
                  >
                    Upgrade
                  </Link>
                  <Link
                    href="/account"
                    className={`btn-premium shrink-0 !min-h-8 !px-2 !py-1.5 text-[10px] lg:text-[11px] ${
                      accountTabActive ? "btn-premium-primary" : "btn-premium-secondary"
                    }`}
                  >
                    Account
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/pricing" className="btn-premium btn-premium-secondary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
                    Pricing
                  </Link>
                  <Link href="/sign-in" className="btn-premium btn-premium-secondary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
                    Sign in
                  </Link>
                  <Link href="/sign-up" className="btn-premium btn-premium-primary !min-h-9 !px-3 !py-2 text-[11px] sm:text-xs md:text-sm">
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
              <div className={navLocked ? "pointer-events-none opacity-40" : ""}>
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
              </div>
              {ready && session ? (
                <select
                  aria-label="Active client workspace"
                  className="input-premium !text-xs"
                  value={clientDropdownValue}
                  onChange={(event) => handleClientDropdownChange(event.target.value)}
                >
                  <option value="" disabled>
                    Select client
                  </option>
                  {isCrmModule && crmProfileOptions.length > 0
                    ? crmProfileOptions.map((company) => (
                      <option key={company.id} value={`crm:${company.id}`}>
                        {truncateLabel(company.name, 36)}
                      </option>
                    ))
                    : clients.map((client) => (
                      <option key={client.id} value={`client:${client.id}`}>
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
                    href="/sign-in"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-premium btn-premium-secondary text-xs"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
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
