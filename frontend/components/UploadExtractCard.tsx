"use client";

import { motion } from "framer-motion";

interface UploadExtractCardProps {
  children: React.ReactNode;
}

export function UploadExtractCard({ children }: UploadExtractCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="surface-card p-4 sm:p-6 md:p-8"
    >
      {children}
    </motion.div>
  );
}
