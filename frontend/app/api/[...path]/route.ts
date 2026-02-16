import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_TIMEOUT_MS = 120000;

function getBackendBaseUrl() {
  const v = process.env.BACKEND_URL?.trim() || "";
  return v.endsWith("/") ? v.slice(0, -1) : v;
}

async function proxyOnce(req: NextRequest, upstreamUrl: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const contentType = req.headers.get("content-type") || "application/octet-stream";

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        "content-type": contentType,
        ...(req.headers.get("accept") ? { accept: req.headers.get("accept")! } : {}),
      },
      body: req.body,
      // Required for streaming body in Node fetch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      duplex: "half" as any,
      signal: controller.signal,
    });

    const text = await upstreamRes.text();
    const resContentType = upstreamRes.headers.get("content-type") || "application/json";

    return new Response(text, {
      status: upstreamRes.status,
      headers: { "content-type": resContentType },
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
  const upstreamUrl = base + path;

  try {
    const first = await proxyOnce(req, upstreamUrl);

    if ([502, 503, 504].includes(first.status)) {
      await new Promise((r) => setTimeout(r, 2000));
      return await proxyOnce(req, upstreamUrl);
    }

    return first;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Proxy error", { path, upstreamUrl, msg });
    const isTimeout = msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout");
    return Response.json(
      { error: isTimeout ? "Upstream timeout" : "Upstream connection failed" },
      { status: 502 }
    );
  }
}
