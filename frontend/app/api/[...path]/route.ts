/**
 * Proxy all /api/* requests to the backend (BACKEND_URL).
 * Ensures lease extraction and normalize calls reach the Render backend even when
 * BACKEND_URL is only set at runtime (e.g. Vercel env).
 */

function getBackendBase(): string {
  const url = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
  if (url) return url;
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8010";
  return "";
}

function getBackendPath(pathSegments: string[]): string {
  return pathSegments.join("/");
}

function copyForwardHeaders(request: Request): Headers {
  const out = new Headers();
  const skip = new Set(["host", "connection", "content-length"]);
  request.headers.forEach((value, key) => {
    if (skip.has(key.toLowerCase())) return;
    out.set(key, value);
  });
  return out;
}

async function proxy(request: Request, pathSegments: string[]): Promise<Response> {
  const BACKEND_URL = getBackendBase();
  if (!BACKEND_URL) {
    return Response.json(
      {
        detail:
          "Backend is not configured. Set BACKEND_URL (e.g. https://your-backend.onrender.com) in your hosting environment (Vercel → Settings → Environment Variables).",
      },
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const path = getBackendPath(pathSegments);
  const url = `${BACKEND_URL}/${path}`;
  const headers = copyForwardHeaders(request);

  // Long timeout so Render cold start (30–60s+) can complete
  const BACKEND_TIMEOUT_MS = 120000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: request.method,
      headers,
      body: request.body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      responseHeaders.set(key, value);
    });

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    const isTimeout = message.toLowerCase().includes("abort") || message.toLowerCase().includes("timeout");
    return Response.json(
      {
        detail: isTimeout
          ? "Backend took too long to respond (e.g. cold start). Please try again in a moment."
          : `Backend request failed: ${message}`,
      },
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  return proxy(request, path);
}
