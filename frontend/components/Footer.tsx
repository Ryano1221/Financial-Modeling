"use client";

import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-400/20 mt-16 sm:mt-20">
      <div className="app-container py-8 sm:py-10">
        <div className="rounded border border-slate-300/20 bg-slate-950/60 px-4 py-4 sm:px-6 sm:py-5">
          <div className="grid w-full grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
            <div className="hidden md:block" aria-hidden="true" />

            <div className="flex justify-center">
              <Image
                src="/brand/logo-white.svg"
                alt="TheCREmodel"
                width={240}
                height={64}
                className="h-10 w-auto object-contain"
              />
            </div>

            <nav className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:justify-end">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center min-h-[38px] px-4 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
              >
                Docs
              </Link>
              <Link
                href="/security"
                className="inline-flex items-center justify-center min-h-[38px] px-4 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
              >
                Security
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center min-h-[38px] px-4 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
              >
                Contact
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
