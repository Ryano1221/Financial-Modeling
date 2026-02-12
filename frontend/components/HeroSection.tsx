"use client";

import { motion } from "framer-motion";

export function HeroSection() {
  const scrollToUpload = () => {
    const el = document.getElementById("upload-section");
    el?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToPreview = () => {
    const el = document.getElementById("workflow-section");
    el?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative min-h-[85vh] flex flex-col overflow-hidden">
      {/* Animated gradient mesh / soft glow background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0b] via-[#0d0d0f] to-[#0a0a0b]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120%] h-[60%] bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.12)_0%,transparent_70%)] blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[80%] h-[40%] bg-[radial-gradient(ellipse_at_bottom_right,rgba(59,130,246,0.08)_0%,transparent_70%)] blur-3xl pointer-events-none" />

      {/* Minimal top nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto w-full">
        <span className="text-lg font-semibold tracking-tight text-white">Lease Deck</span>
        <div className="flex items-center gap-6 text-sm">
          <a href="#" className="text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Docs</a>
          <a href="#" className="text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Security</a>
          <a href="#" className="text-zinc-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] rounded">Contact</a>
        </div>
      </nav>

      {/* Hero content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white max-w-4xl leading-[1.1]"
        >
          Lease financial analysis in minutes
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 text-lg sm:text-xl text-zinc-400 max-w-2xl"
        >
          Upload a proposal, validate the terms, generate a white labeled memo ready PDF.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <button
            type="button"
            onClick={scrollToUpload}
            className="rounded-full bg-[#3b82f6] text-white px-8 py-3.5 text-sm font-semibold hover:bg-[#2563eb] hover:shadow-[0_0_30px_var(--accent-glow)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
          >
            Upload proposal
          </button>
          <button
            type="button"
            onClick={scrollToPreview}
            className="rounded-full border border-white/20 bg-white/5 text-white px-8 py-3.5 text-sm font-medium hover:bg-white/10 hover:border-white/30 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-[#0a0a0b] active:scale-[0.98]"
          >
            View example report preview
          </button>
        </motion.div>
      </div>
    </section>
  );
}
