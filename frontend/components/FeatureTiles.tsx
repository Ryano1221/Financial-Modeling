"use client";

import { motion } from "framer-motion";

const features = [
  {
    title: "Extract terms",
    description: "Upload PDF or DOCX. AI extracts key lease terms and builds a scenario for review.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: "Model scenarios",
    description: "Compare renewal vs relocate, edit assumptions, run cashflow analysis.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: "Generate memo",
    description: "White labeled PDF report, institutional layout, ready for client delivery.",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
];

const trustedBy = ["JLL", "CBRE", "Cushman", "Newmark"];

export function FeatureTiles() {
  return (
    <section className="relative z-10 px-6 py-16 md:py-24">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 hover:border-white/15 hover:bg-white/[0.05] transition-all duration-300"
            >
              <div className="text-[#3b82f6] mb-4">{feature.icon}</div>
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Trusted by - placeholders only */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-20 pt-16 border-t border-white/10"
        >
          <p className="text-xs uppercase tracking-widest text-zinc-500 text-center mb-6">
            Trusted by leading firms
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10 md:gap-16">
            {trustedBy.map((name) => (
              <span
                key={name}
                className="text-zinc-500 text-sm font-medium grayscale opacity-70"
                aria-hidden
              >
                {name}
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-600 text-center mt-4">
            Placeholder logos — no endorsement implied
          </p>
        </motion.div>
      </div>
    </section>
  );
}
