"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export function TopNav() {
  const pathname = usePathname();
  // Keep exported report routes presentation-only (no app chrome).
  if (pathname?.startsWith("/report")) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-sm print:hidden">
      <div className="mx-auto w-full max-w-[120rem] px-4 py-3 sm:px-6 lg:px-8 2xl:px-10 flex items-center justify-between gap-3 sm:gap-4 min-w-0">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0 min-w-0"
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
          <span className="hidden sm:inline text-base font-semibold text-white whitespace-nowrap sm:text-lg">
            TheCREmodel
          </span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-6 shrink-0 min-w-0">
          <Link
            href="/#extract"
            className="text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Upload lease
          </Link>
          <Link
            href="/example"
            className="hidden sm:inline text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Example report
          </Link>
        </nav>
      </div>
    </header>
  );
}
