#!/usr/bin/env node
/**
 * Production environment guard. Run before `next build` when NODE_ENV=production.
 * Enforces exact Ryan's domain so the app always updates to thecremodel.com.
 * - NEXT_PUBLIC_SITE_URL must equal https://thecremodel.com (exact).
 * - NEXT_PUBLIC_API_BASE_URL must equal https://financial-modeling-docker.onrender.com (exact).
 * Build fails if not exact.
 */
const isProduction = process.env.NODE_ENV === "production";

const CANONICAL_SITE = "https://thecremodel.com";
const CANONICAL_API = "https://financial-modeling-docker.onrender.com";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();

console.log("RESOLVED_API_BASE_URL", apiBase || "(empty – build will fail)");
console.log("RESOLVED_SITE_URL", siteUrl || "(empty – build will fail)");

if (!isProduction) {
  process.exit(0);
}

const errors = [];

if (!siteUrl) {
  errors.push("Production requires NEXT_PUBLIC_SITE_URL to be set.");
} else if (siteUrl !== CANONICAL_SITE) {
  errors.push(`Production requires NEXT_PUBLIC_SITE_URL to be exactly ${CANONICAL_SITE}. Got: ${siteUrl}`);
}

if (!apiBase) {
  errors.push("Production requires NEXT_PUBLIC_API_BASE_URL to be set.");
} else if (apiBase !== CANONICAL_API) {
  errors.push(`Production requires NEXT_PUBLIC_API_BASE_URL to be exactly ${CANONICAL_API}. Got: ${apiBase}`);
}

// Forbid any use of localhost or vercel preview in either
const forbidden = ["localhost", "127.0.0.1", "vercel.app"];
for (const f of forbidden) {
  if (siteUrl.toLowerCase().includes(f)) {
    errors.push(`NEXT_PUBLIC_SITE_URL must not contain "${f}". Use exactly ${CANONICAL_SITE}.`);
    break;
  }
  if (apiBase.toLowerCase().includes(f)) {
    errors.push(`NEXT_PUBLIC_API_BASE_URL must not contain "${f}". Use exactly ${CANONICAL_API}.`);
    break;
  }
}

if (errors.length > 0) {
  console.error("\n❌ Production environment check failed:\n");
  errors.forEach((e) => console.error("  •", e));
  console.error("\nIn Vercel Production set exactly:\n  NEXT_PUBLIC_SITE_URL=https://thecremodel.com\n  NEXT_PUBLIC_API_BASE_URL=https://financial-modeling-docker.onrender.com\n");
  process.exit(1);
}

process.exit(0);
