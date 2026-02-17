#!/usr/bin/env node
/**
 * Production environment guard.
 *
 * Required in Production:
 * - BACKEND_URL (server-side proxy target used by /api/[...path])
 *
 * Optional in Production (warn only):
 * - NEXT_PUBLIC_SITE_URL (recommended: https://thecremodel.com)
 * - NEXT_PUBLIC_API_BASE_URL (recommended: https://financial-modeling-docker.onrender.com)
 *
 * Build should fail only for missing/invalid BACKEND_URL.
 */
const isProduction = process.env.NODE_ENV === "production";
if (!isProduction) process.exit(0);

const FORBIDDEN = ["localhost", "127.0.0.1", "vercel.app"];
const RECOMMENDED_SITE = "https://thecremodel.com";
const RECOMMENDED_API = "https://financial-modeling-docker.onrender.com";

const backendUrl = (process.env.BACKEND_URL || "").trim();
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();

const errors = [];
const warnings = [];

if (!backendUrl) {
  errors.push("Production requires BACKEND_URL to be set (Render backend URL used by /api proxy).");
} else {
  const lower = backendUrl.toLowerCase();
  for (const f of FORBIDDEN) {
    if (lower.includes(f)) {
      errors.push(`BACKEND_URL must not contain \"${f}\". Use your Render backend URL.`);
      break;
    }
  }
}

if (!siteUrl) {
  warnings.push(`NEXT_PUBLIC_SITE_URL is unset. Recommended: ${RECOMMENDED_SITE}`);
} else if (siteUrl !== RECOMMENDED_SITE) {
  warnings.push(`NEXT_PUBLIC_SITE_URL is \"${siteUrl}\". Recommended: ${RECOMMENDED_SITE}`);
}

if (!apiBase) {
  warnings.push(`NEXT_PUBLIC_API_BASE_URL is unset. Recommended: ${RECOMMENDED_API}`);
} else if (apiBase !== RECOMMENDED_API) {
  warnings.push(`NEXT_PUBLIC_API_BASE_URL is \"${apiBase}\". Recommended: ${RECOMMENDED_API}`);
}

console.log("RESOLVED_BACKEND_URL", backendUrl || "(empty)");
console.log("RESOLVED_SITE_URL", siteUrl || "(empty)");
console.log("RESOLVED_API_BASE_URL", apiBase || "(empty)");

if (warnings.length > 0) {
  console.warn("\n⚠️ Production environment warnings:\n");
  warnings.forEach((w) => console.warn("  •", w));
  console.warn("");
}

if (errors.length > 0) {
  console.error("\n❌ Production environment check failed:\n");
  errors.forEach((e) => console.error("  •", e));
  console.error("\nSet BACKEND_URL in Vercel Production to your Render backend URL.\n");
  process.exit(1);
}

process.exit(0);
