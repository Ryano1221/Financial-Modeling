"use client";

import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-400/20 mt-16 sm:mt-20">
      <div className="app-container py-8 sm:py-10">
        <div className="rounded border border-slate-300/20 bg-slate-950/60 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="inline-flex w-fit items-center focus:outline-none focus-ring" aria-label="Go to landing page">
              <Image
                src="/brand/logo-white.svg"
                alt="TheCREmodel"
                width={240}
                height={64}
                className="h-10 w-auto object-contain"
              />
            </Link>

            <nav className="flex flex-wrap items-center justify-start gap-2 sm:gap-3 sm:justify-end">
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
