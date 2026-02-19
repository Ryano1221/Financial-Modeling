import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_TIMEOUT_MS = 300000;

function getBackendBaseUrl() {
  const v =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    "";
  return v.endsWith("/") ? v.slice(0, -1) : v;
}

async function proxyOnce(req: NextRequest, upstreamUrl: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const contentType = req.headers.get("content-type");
    const accept = req.headers.get("accept");
    const authorization = req.headers.get("authorization");
    const cookie = req.headers.get("cookie");
    const xInternalSecret = req.headers.get("x-internal-secret");
    const xRequestId = req.headers.get("x-request-id");

    const fetchInit: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
        ...(accept ? { accept } : {}),
        ...(authorization ? { authorization } : {}),
        ...(cookie ? { cookie } : {}),
        ...(xInternalSecret ? { "x-internal-secret": xInternalSecret } : {}),
        ...(xRequestId ? { "x-request-id": xRequestId } : {}),
      },
      body: req.body,
      duplex: "half",
      signal: controller.signal,
    };
    const upstreamRes = await fetch(upstreamUrl, fetchInit);

    const bytes = await upstreamRes.arrayBuffer();
    const resHeaders = new Headers();
    const upstreamContentType = upstreamRes.headers.get("content-type");
    const upstreamContentDisposition = upstreamRes.headers.get("content-disposition");
    const upstreamCacheControl = upstreamRes.headers.get("cache-control");
    const upstreamRequestId = upstreamRes.headers.get("x-request-id");

    if (upstreamContentType) resHeaders.set("content-type", upstreamContentType);
    if (upstreamContentDisposition) resHeaders.set("content-disposition", upstreamContentDisposition);
    if (upstreamCacheControl) resHeaders.set("cache-control", upstreamCacheControl);
    if (upstreamRequestId) resHeaders.set("x-request-id", upstreamRequestId);

    return new Response(bytes, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return handle(req, ctx);
}

async function handle(req: NextRequest, ctx: RouteContext) {
  const base = getBackendBaseUrl();
  if (!base) {
    return Response.json({ error: "BACKEND_URL not set" }, { status: 503 });
  }

  const { path: pathSegments } = await ctx.params;
  const path = "/" + (pathSegments || []).join("/");
  const upstreamUrl = base + path + req.nextUrl.search;

  try {
    const first = await proxyOnce(req, upstreamUrl);

    if ([502, 503, 504].includes(first.status)) {
      await new Promise((r) => setTimeout(r, 2000));
      return await proxyOnce(req, upstreamUrl);
    }

    return first;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Proxy error", { path, upstreamUrl, msg });
    const isTimeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return Response.json(
      { error: isTimeout ? "Upstream timeout" : "Upstream connection failed" },
      { status: 502 }
    );
  }
}
