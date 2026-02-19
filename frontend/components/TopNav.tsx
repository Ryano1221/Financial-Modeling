"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function TopNav() {
  const pathname = usePathname();
  // Keep exported report routes presentation-only (no app chrome).
  if (pathname?.startsWith("/report")) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 print:hidden border-b border-white/20 bg-black/95 backdrop-blur-sm">
      <div className="app-container flex items-center justify-between gap-3 sm:gap-4 min-w-0 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0 min-w-0 rounded px-1 py-1 transition-colors"
          aria-label="TheCREmodel home"
        >
          <Image
            src="/brand/logo.svg"
            alt="The Commercial Real Estate Model logo"
            width={140}
            height={32}
            className="h-7 sm:h-8 w-auto object-contain"
            priority
            sizes="(max-width: 640px) 112px, 140px"
          />
        </Link>
      </div>
    </header>
  );
}
