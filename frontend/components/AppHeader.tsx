"use client";

import Link from "next/link";

export function AppHeader() {
  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="text-lg font-semibold text-stone-800 hover:text-stone-900">
          Lease Deck
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
