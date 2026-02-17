"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getBackendBaseUrlForDisplay, logResolvedUrlsOnce } from "@/lib/backend";
import { FRONTEND_BUILD_VERSION } from "@/lib/build-version";

let _buildVersionLogged = false;
function logBuildVersionOnce(): void {
  if (_buildVersionLogged) return;
  _buildVersionLogged = true;
  console.log("[build] FRONTEND_BUILD_VERSION", FRONTEND_BUILD_VERSION);
}

function DebugBackendUrlInner() {
  const searchParams = useSearchParams();
  const debug = searchParams.get("debug") === "1";
  const isProd = process.env.NODE_ENV === "production";

  useEffect(() => {
    logBuildVersionOnce();
    if (!isProd) logResolvedUrlsOnce();
  }, [isProd]);

  if (isProd && !debug) return null;
  if (isProd && debug) {
    return (
      <footer className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 text-xs text-zinc-400 px-3 py-1.5 border-t border-white/10 font-mono">
        BACKEND: {getBackendBaseUrlForDisplay()}
      </footer>
    );
  }
  return null;
}

export function DebugBackendUrl() {
  return (
    <Suspense fallback={null}>
      <DebugBackendUrlInner />
    </Suspense>
  );
}
