"use client";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10 mt-24">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-sm font-medium text-zinc-500">Lease Deck</span>
        <div className="flex items-center gap-6 text-sm text-zinc-500">
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Docs</a>
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Security</a>
          <a href="#" className="hover:text-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Contact</a>
        </div>
      </div>
    </footer>
  );
}
