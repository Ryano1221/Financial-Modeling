"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "@/lib/env";
import { usePathname } from "next/navigation";

/** Visible build stamp for production verification. Shows on live site so Ryan can confirm domain is serving the new build. */
export function BuildStamp() {
  const pathname = usePathname();
  const [resolvedApi, setResolvedApi] = useState("");

  useEffect(() => {
    setResolvedApi(getApiBaseUrl());
  }, []);
  if (pathname?.startsWith("/report")) return null;

  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
  const time = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <div className="print:hidden border-t border-white/5">
      <div className="app-container py-2">
        <details className="group">
          <summary className="inline-flex cursor-pointer select-none items-center gap-2 text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors">
            Build details
          </summary>
          <div className="mt-2 rounded border border-white/10 bg-black/40 px-3 py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-500">
              <span>BUILD_SHA={sha || "(unset)"}</span>
              <span>BUILD_TIME={time || "(unset)"}</span>
              <span>VERCEL_ENV={vercelEnv || "(unset)"}</span>
              <span>NEXT_PUBLIC_SITE_URL={siteUrl || "(unset)"}</span>
              <span>RESOLVED_API_BASE_URL={resolvedApi || "(resolving...)"}</span>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
