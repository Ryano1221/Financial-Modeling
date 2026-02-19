"use client";

import { FRONTEND_BUILD_VERSION } from "@/lib/build-version";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-slate-400/20 mt-16 sm:mt-20">
      <div className="app-container py-8 sm:py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-center sm:text-left text-xs sm:text-sm font-medium text-slate-400">
          TheCREmodel <span className="text-slate-500 font-normal">build {FRONTEND_BUILD_VERSION}</span>
        </span>
        <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm text-slate-400">
          <a href="#" className="hover:text-slate-100 transition-colors focus:outline-none focus-ring rounded">Docs</a>
          <a href="#" className="hover:text-slate-100 transition-colors focus:outline-none focus-ring rounded">Security</a>
          <a href="#" className="hover:text-slate-100 transition-colors focus:outline-none focus-ring rounded">Contact</a>
        </div>
      </div>
    </footer>
  );
}
