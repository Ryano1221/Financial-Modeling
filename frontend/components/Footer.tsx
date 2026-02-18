"use client";

import { FRONTEND_BUILD_VERSION } from "@/lib/build-version";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 mt-24">
      <div className="mx-auto w-full max-w-[120rem] px-4 py-8 sm:px-6 sm:py-10 lg:px-8 2xl:px-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-center sm:text-left text-xs sm:text-sm font-medium text-zinc-500">
          TheCREmodel <span className="text-zinc-600 font-normal">build {FRONTEND_BUILD_VERSION}</span>
        </span>
        <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm text-zinc-500">
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Docs</a>
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Security</a>
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Contact</a>
        </div>
      </div>
    </footer>
  );
}
