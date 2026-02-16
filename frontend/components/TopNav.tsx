"use client";

import Link from "next/link";
import Image from "next/image";

export function TopNav() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4 min-w-0">
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
            className="h-8 w-auto object-contain"
            priority
            sizes="140px"
          />
          <span className="text-base font-semibold text-white whitespace-nowrap sm:text-lg">
            TheCREmodel
          </span>
        </Link>
        <nav className="flex items-center gap-6 shrink-0">
          <Link
            href="/#extract"
            className="text-sm font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Upload lease
          </Link>
          <Link
            href="/example"
            className="text-sm font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Example report
          </Link>
        </nav>
      </div>
    </header>
  );
}
