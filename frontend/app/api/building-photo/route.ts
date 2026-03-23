import { NextRequest, NextResponse } from "next/server";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[::1\]$/i,
];

function isAllowedRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.port && !["80", "443"].includes(parsed.port)) return false;
    return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const target = String(request.nextUrl.searchParams.get("target") || "").trim();
  const source = String(request.nextUrl.searchParams.get("source") || "").trim();

  if (!isAllowedRemoteUrl(target)) {
    return NextResponse.json({ detail: "Invalid remote image target." }, { status: 400 });
  }

  const headers = new Headers({
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (compatible; theCREmodel/1.0; +https://thecremodel.com)",
  });

  if (isAllowedRemoteUrl(source)) {
    const sourceUrl = new URL(source);
    headers.set("Referer", source);
    headers.set("Origin", sourceUrl.origin);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers,
      redirect: "follow",
      cache: "force-cache",
    });
  } catch {
    return NextResponse.json({ detail: "Unable to fetch remote image." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ detail: "Remote image request failed." }, { status: 502 });
  }

  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.startsWith("image/")) {
    return NextResponse.json({ detail: "Remote asset is not an image." }, { status: 415 });
  }

  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", contentType || "image/jpeg");
  responseHeaders.set("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) responseHeaders.set("Content-Length", contentLength);

  return new NextResponse(upstream.body, {
    status: 200,
    headers: responseHeaders,
  });
}
