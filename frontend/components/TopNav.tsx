"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function TopNav() {
  const pathname = usePathname();
  // Keep exported report routes presentation-only (no app chrome).
  if (pathname?.startsWith("/report")) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 print:hidden border-b border-slate-400/20 bg-slate-950/78 backdrop-blur-xl shadow-[0_6px_28px_rgba(2,6,23,0.45)]">
      <div className="app-container flex items-center justify-between gap-3 sm:gap-4 min-w-0 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0 min-w-0 rounded-xl px-1 py-1 transition-colors hover:bg-white/5"
          aria-label="TheCREmodel home"
        >
          <Image
            src="/brand/logo.png"
            alt="The Commercial Real Estate Model logo"
            width={140}
            height={32}
            className="h-7 sm:h-8 w-auto object-contain"
            priority
            sizes="(max-width: 640px) 112px, 140px"
          />
          <span className="hidden sm:inline text-base font-semibold text-slate-100 whitespace-nowrap sm:text-lg tracking-tight">
            TheCREmodel
          </span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-6 shrink-0 min-w-0">
          <Link
            href="/#extract"
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors whitespace-nowrap"
          >
            Upload lease
          </Link>
          <Link
            href="/example"
            className="hidden sm:inline text-xs sm:text-sm font-medium text-slate-300 hover:text-slate-100 transition-colors whitespace-nowrap"
          >
            Example report
          </Link>
        </nav>
      </div>
    </header>
  );
}
