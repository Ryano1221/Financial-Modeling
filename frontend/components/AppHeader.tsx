"use client";

import Link from "next/link";
import Image from "next/image";

export function AppHeader() {
  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0 min-w-0"
          aria-label="TheCREmodel home"
        >
          <Image
            src="/brand/logo-black.svg"
            alt="The Commercial Real Estate Model logo"
            width={120}
            height={32}
            className="h-7 w-auto object-contain sm:h-8"
            priority
            sizes="(max-width: 640px) 100px, 120px"
          />
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/upload" className="text-sm text-stone-600 hover:text-stone-900">
            Upload lease
          </Link>
        </nav>
      </div>
    </header>
  );
}
