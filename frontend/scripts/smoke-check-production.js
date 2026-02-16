#!/usr/bin/env node
/**
 * Deployment smoke check: fetch production URL and assert:
 * - HTML title contains "The Commercial Real Estate Model" or "theCREmodel"
 * - No forbidden strings (localhost, 127.0.0.1, Diagnostics, etc.)
 * - Same-origin API proxy is healthy at /api/health (ensures website -> Render path works)
 * Run after deploy in CI or manually: node scripts/smoke-check-production.js
 */
const PRODUCTION_URL = process.env.SMOKE_CHECK_URL || "https://thecremodel.com";
const FORBIDDEN = [
  "localhost",
  "127.0.0.1",
  "Diagnostics",
  "Test backend connection",
  "npm run",
  "npx ",
  "curl ",
];
const TITLE_MUST_CONTAIN = ["The Commercial Real Estate Model", "theCREmodel"];

async function main() {
  let html;
  let base;
  try {
    const res = await fetch(PRODUCTION_URL, {
      redirect: "follow",
      headers: { "User-Agent": "thecremodel-smoke-check/1.0" },
    });
    if (!res.ok) {
      console.error(`❌ Smoke check failed: ${PRODUCTION_URL} returned ${res.status}`);
      process.exit(1);
    }
    base = new URL(res.url || PRODUCTION_URL).origin;
    html = await res.text();
  } catch (err) {
    console.error("❌ Smoke check failed: could not fetch", PRODUCTION_URL, err);
    process.exit(1);
  }

  const lower = html.toLowerCase();
  for (const phrase of FORBIDDEN) {
    if (lower.includes(phrase.toLowerCase())) {
      console.error(`❌ Smoke check failed: page contains forbidden string "${phrase}"`);
      process.exit(1);
    }
  }

  const hasTitle = TITLE_MUST_CONTAIN.some((t) => html.includes(t));
  if (!hasTitle) {
    console.error(
      `❌ Smoke check failed: page title must contain one of: ${TITLE_MUST_CONTAIN.join(", ")}`
    );
    process.exit(1);
  }

  try {
    const apiRes = await fetch(`${base}/api/health`, {
      redirect: "follow",
      headers: { "User-Agent": "thecremodel-smoke-check/1.0" },
    });
    if (!apiRes.ok) {
      console.error(`❌ Smoke check failed: ${base}/api/health returned ${apiRes.status}`);
      process.exit(1);
    }
    const body = await apiRes.json().catch(() => null);
    if (!body || body.status !== "ok") {
      console.error(`❌ Smoke check failed: ${base}/api/health did not return {\"status\":\"ok\"}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Smoke check failed: could not reach ${base}/api/health`, err);
    process.exit(1);
  }

  console.log("✅ Smoke check passed:", PRODUCTION_URL, "(including /api/health)");
  process.exit(0);
}

main();
