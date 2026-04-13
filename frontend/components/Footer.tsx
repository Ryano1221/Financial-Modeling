"use client";

import Image from "next/image";
import Link from "next/link";
import { useClientWorkspace } from "@/components/workspace/ClientWorkspaceProvider";

export function Footer() {
  const { ready, session, cloudSyncStatus, cloudSyncMessage } = useClientWorkspace();
  const isOnline = Boolean(ready && session && cloudSyncStatus !== "local" && cloudSyncStatus !== "error");
  const syncLabel = isOnline ? "Online" : session ? "Local" : "Sign in to sync";
  const syncTitle = session
    ? cloudSyncMessage || (isOnline ? "Cloud workspace sync is online." : "Saving on this device only.")
    : "Local device only. Sign in to sync this workspace across devices.";

  return (
    <footer className="relative z-10 mt-0 border-t border-white/8 sm:mt-1">
      <div className="app-container py-2 sm:py-2.5">
        <div className="relative border border-white/8 bg-[linear-gradient(180deg,rgba(17,19,24,0.96),rgba(22,26,34,0.96))] px-4 pb-5 pt-2.5 sm:px-6 sm:pb-4 sm:pt-3">
          <div className="flex min-h-[58px] w-full items-center justify-between gap-4">
            <Link href="/" className="inline-flex w-fit items-center focus:outline-none" aria-label="Go to landing page">
              <div className="brand-lockup">
                <Image
                  src="/brand/logo-white.svg"
                  alt="TheCREmodel"
                  width={148}
                  height={31}
                  className="brand-wordmark"
                />
                <span className="brand-subtext">
                  Commercial Real Estate Intelligence
                </span>
              </div>
            </Link>

            <nav className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              <Link
                href="/about"
                className="inline-flex min-h-[34px] items-center justify-center border border-white/8 bg-[rgba(255,255,255,0.03)] px-3.5 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(0,229,255,0.18)] hover:text-[var(--text)] focus:outline-none focus-ring sm:text-xs"
              >
                About
              </Link>
              <Link
                href="/docs"
                className="inline-flex min-h-[34px] items-center justify-center border border-white/8 bg-[rgba(255,255,255,0.03)] px-3.5 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(0,229,255,0.18)] hover:text-[var(--text)] focus:outline-none focus-ring sm:text-xs"
              >
                Docs
              </Link>
              <Link
                href="/security"
                className="inline-flex min-h-[34px] items-center justify-center border border-white/8 bg-[rgba(255,255,255,0.03)] px-3.5 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(0,229,255,0.18)] hover:text-[var(--text)] focus:outline-none focus-ring sm:text-xs"
              >
                Security
              </Link>
              <Link
                href="/contact"
                className="inline-flex min-h-[34px] items-center justify-center border border-white/8 bg-[rgba(255,255,255,0.03)] px-3.5 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] transition-colors hover:border-[rgba(0,229,255,0.18)] hover:text-[var(--text)] focus:outline-none focus-ring sm:text-xs"
              >
                Contact
              </Link>
            </nav>
          </div>
          <p
            className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              isOnline ? "text-[rgba(101,255,198,0.82)]" : "text-[rgba(255,215,89,0.82)]"
            }`}
            title={syncTitle}
            aria-live="polite"
          >
            {syncLabel}
          </p>
        </div>
      </div>
    </footer>
  );
}
