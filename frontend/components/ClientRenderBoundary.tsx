"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ClientRenderBoundaryProps {
  children: ReactNode;
  title?: string;
  description?: string;
  resetKeys?: Array<string | number | boolean | null | undefined>;
}

interface ClientRenderBoundaryState {
  hasError: boolean;
}

function sameResetKeys(
  left: ClientRenderBoundaryProps["resetKeys"],
  right: ClientRenderBoundaryProps["resetKeys"],
): boolean {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export class ClientRenderBoundary extends Component<
  ClientRenderBoundaryProps,
  ClientRenderBoundaryState
> {
  state: ClientRenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ClientRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[client-render-boundary]", error, info);
  }

  componentDidUpdate(prevProps: ClientRenderBoundaryProps): void {
    if (this.state.hasError && !sameResetKeys(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 sm:p-5">
        <p className="heading-kicker mb-2">Module Notice</p>
        <h3 className="text-base font-semibold text-amber-100">
          {this.props.title || "This view needs a refresh."}
        </h3>
        <p className="mt-2 text-sm text-amber-50/85">
          {this.props.description || "This section hit a client-side render issue. Your imported data is still saved."}
        </p>
      </div>
    );
  }
}
