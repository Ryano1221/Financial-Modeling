#!/usr/bin/env node
/**
 * Production environment guard. Run before `next build` when NODE_ENV=production.
 * - Requires NEXT_PUBLIC_BACKEND_URL (browser calls Render directly; no Vercel proxy).
 * - Forbids NEXT_PUBLIC_BACKEND_URL containing localhost or 127.0.0.1.
 * BACKEND_URL is no longer used by the frontend.
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
      errors.push(`Production build forbids ${name} containing "${f}". Set ${name} to your production backend URL (e.g. https://financial-modeling-docker.onrender.com).`);
      break;
    }
  }
}

check("NEXT_PUBLIC_BACKEND_URL", process.env.NEXT_PUBLIC_BACKEND_URL);

if (errors.length > 0) {
  console.error("\n❌ Production environment check failed:\n");
  errors.forEach((e) => console.error("  •", e));
  console.error("\nAdd NEXT_PUBLIC_BACKEND_URL in Vercel → Project → Settings → Environment Variables for Production (no trailing slash).\n");
  process.exit(1);
}

process.exit(0);
