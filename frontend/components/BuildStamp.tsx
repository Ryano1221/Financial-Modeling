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
    <div className="mt-6 pt-4 border-t border-white/5 print:hidden">
      <p className="text-xs font-mono text-zinc-500 break-all">
        BUILD_SHA={sha || "(unset)"} · BUILD_TIME={time || "(unset)"} · VERCEL_ENV={vercelEnv || "(unset)"} · NEXT_PUBLIC_SITE_URL={siteUrl || "(unset)"} · RESOLVED_API_BASE_URL={resolvedApi || "(resolving...)"}
      </p>
    </div>
  );
}
