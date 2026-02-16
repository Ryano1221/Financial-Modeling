import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PRODUCTION_APEX = "thecremodel.com";
const ENABLE_APEX_REDIRECT = process.env.ENABLE_APEX_REDIRECT === "true";

/**
 * Domain redirects are disabled by default to avoid redirect loops with Vercel domain settings.
 * If needed, enable explicitly with ENABLE_APEX_REDIRECT=true.
 */
export function middleware(request: NextRequest) {
  if (!ENABLE_APEX_REDIRECT || process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const host = request.headers.get("host") ?? "";
  const url = request.nextUrl.clone();

  if (host.toLowerCase() === `www.${PRODUCTION_APEX}`) {
    url.host = PRODUCTION_APEX;
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on all pathnames except _next/static, _next/image, favicon, brand assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|brand/).*)",
  ],
};
