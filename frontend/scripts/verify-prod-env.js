#!/usr/bin/env node
/**
 * Production environment guard. Run before `next build` when NODE_ENV=production.
 * - Requires BACKEND_URL to be set (server-side /api rewrites to Render/backend).
 * - Forbids BACKEND_URL containing localhost or 127.0.0.1.
 * - Requires NEXT_PUBLIC_BACKEND_URL to be empty in production so browser always uses same-origin /api.
 * Fails the build with a clear message so production always routes via website domain.
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
  errors.push(
    "Production requires NEXT_PUBLIC_BACKEND_URL to be unset/empty so browser traffic always goes through same-origin /api."
  );
}

if (errors.length > 0) {
  console.error("\n❌ Production environment check failed:\n");
  errors.forEach((e) => console.error("  •", e));
  console.error("\nAdd and set these variables in Vercel → Project → Settings → Environment Variables for Production.\n");
  process.exit(1);
}

process.exit(0);
