import { getApiBaseUrl } from "@/lib/env";
import { NextResponse } from "next/server";

/**
 * Proof endpoint: returns build and env info so we can confirm what build is live on the domain.
 * GET /api/version
 */
export function GET() {
  const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const apiBaseUrl = getApiBaseUrl();

  const res = NextResponse.json({
    buildSha,
    buildTime,
    vercelEnv,
    siteUrl,
    apiBaseUrl,
  });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return res;
}
