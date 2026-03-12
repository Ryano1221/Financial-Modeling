"use client";

import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-400/20 mt-12 sm:mt-16">
      <div className="app-container py-4 sm:py-5">
        <div className="rounded border border-slate-300/20 bg-slate-950/60 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-h-[58px] w-full items-center justify-between gap-4">
            <Link href="/" className="inline-flex w-fit items-center focus:outline-none focus-ring" aria-label="Go to landing page">
              <Image
                src="/brand/logo-white.svg"
                alt="TheCREmodel"
                width={240}
                height={64}
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </Link>

            <nav className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center min-h-[34px] px-3.5 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
              >
                Docs
              </Link>
              <Link
                href="/security"
                className="inline-flex items-center justify-center min-h-[34px] px-3.5 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
              >
                Security
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center min-h-[34px] px-3.5 text-xs sm:text-sm font-medium text-slate-200 border border-slate-300/35 bg-slate-900/60 hover:bg-slate-800/70 hover:text-white transition-colors focus:outline-none focus-ring"
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
