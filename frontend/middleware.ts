import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PRODUCTION_APEX = "thecremodel.com";
const PRODUCTION_HTTPS = "https://thecremodel.com";

/**
 * Force domain consistency: redirect www to apex so production is always served at https://thecremodel.com.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const url = request.nextUrl.clone();

  if (host.toLowerCase().startsWith("www.")) {
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
