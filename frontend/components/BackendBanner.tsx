"use client";

import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/lib/config";

const HEALTH_RETRIES = 3;
const HEALTH_RETRY_DELAY_MS = 500;

async function checkBackendHealth(url: string): Promise<boolean> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HEALTH_RETRIES; attempt++) {
    try {
      const res = await fetch(`${url}/health`, { method: "GET" });
      if (res.ok) return true;
    } catch (e) {
      lastError = e;
    }
    if (attempt < HEALTH_RETRIES) {
      await new Promise((r) => setTimeout(r, HEALTH_RETRY_DELAY_MS));
    }
  }
  return false;
}

export function BackendBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkBackendHealth(BACKEND_URL).then((ok) => {
      if (!cancelled && !ok) setShowBanner(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showBanner) return null;

  return (
    <div
      className="sticky top-0 left-0 right-0 z-50 px-4 py-2 bg-amber-500/20 border-b border-amber-500/40 text-amber-200 text-sm text-center"
      role="alert"
    >
      Backend not reachable at {BACKEND_URL}. Start server with:{" "}
      <code className="font-mono text-xs bg-black/30 px-1 rounded">
        cd backend && uvicorn main:app --reload --port 8010
      </code>
    </div>
  );
}
