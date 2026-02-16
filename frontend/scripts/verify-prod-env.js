#!/usr/bin/env node
/**
 * Production environment guard. Run before `next build` when NODE_ENV=production.
 * - Requires BACKEND_URL to be set (app/api/[...path]/route.ts proxies /api/* to this URL).
 * - Forbids BACKEND_URL containing localhost or 127.0.0.1.
 * - NEXT_PUBLIC_BACKEND_URL is ignored in production (same-origin /api).
 * Fails the build only for invalid/missing BACKEND_URL.
 */
const isProduction = process.env.NODE_ENV === "production";

if (!isProduction) {
  process.exit(0);
}

const FORBIDDEN = ["localhost", "127.0.0.1"];
const errors = [];

function check(name, value) {
  if (value == null || String(value).trim() === "") {
    errors.push(`Production build requires ${name} to be set (e.g. in Vercel Project → Settings → Environment Variables).`);
    return;
  }
  const lower = String(value).toLowerCase();
  for (const f of FORBIDDEN) {
    if (lower.includes(f)) {
      errors.push(`Production build forbids ${name} containing "${f}". Set ${name} to your production API URL (e.g. https://api.thecremodel.com).`);
      break;
    }
  }
}

check("BACKEND_URL", process.env.BACKEND_URL);
const publicBackend = (process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
if (publicBackend) {
  console.warn(
    "⚠️ NEXT_PUBLIC_BACKEND_URL is set in Production. It is ignored because production is forced to same-origin /api."
  );
}

if (errors.length > 0) {
  console.error("\n❌ Production environment check failed:\n");
  errors.forEach((e) => console.error("  •", e));
  console.error("\nAdd and set these variables in Vercel → Project → Settings → Environment Variables for Production.\n");
  process.exit(1);
}

process.exit(0);
