"use client";

import { Panel } from "@/components/Panel";

interface UploadExtractCardProps {
  children: React.ReactNode;
}

export function UploadExtractCard({ children }: UploadExtractCardProps) {
  return (
    <Panel className="p-4 sm:p-6 md:p-8 reveal-on-scroll">
      {children}
    </Panel>
  );
}
