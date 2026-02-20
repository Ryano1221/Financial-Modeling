"use client";

import { Panel } from "@/components/Panel";

interface ResultsActionsCardProps {
  children: React.ReactNode;
}

export function ResultsActionsCard({ children }: ResultsActionsCardProps) {
  return (
    <Panel className="p-4 sm:p-6 md:p-8 reveal-on-scroll">
      {children}
    </Panel>
  );
}
