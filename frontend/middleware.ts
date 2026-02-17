import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PRODUCTION_APEX = "thecremodel.com";

/**
 * Enforce canonical host in production so the document request is always thecremodel.com,
 * not financial-modeling-*.vercel.app. Only host === "thecremodel.com" (apex) is allowed.
 * - www.thecremodel.com → 308 https://thecremodel.com (path + query preserved)
 * - *.vercel.app (e.g. financial-modeling-xxx.vercel.app) → 308 https://thecremodel.com
 * - any other host → 308 https://thecremodel.com
 * Also adds x-build-sha, x-build-time, x-vercel-env on every production response.
 */
export function middleware(request: NextRequest) {
  const isProduction = process.env.NODE_ENV === "production";
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];

  if (isProduction && host !== PRODUCTION_APEX) {
    const url = request.nextUrl.clone();
    url.host = PRODUCTION_APEX;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const res = NextResponse.next();
  if (isProduction) {
    const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "";
    const time = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
    const env = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "";
    res.headers.set("x-build-sha", sha);
    res.headers.set("x-build-time", time);
    res.headers.set("x-vercel-env", env);
  }
  return res;
}

export const config = {
  matcher: [
    // Run on all routes (including /, /api/version, etc.) except static assets
    "/((?!_next/static|_next/image|favicon.ico|brand/).*)",
  ],
};
