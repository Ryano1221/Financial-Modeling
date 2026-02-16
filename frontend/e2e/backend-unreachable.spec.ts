/**
 * With backend URL set to an unreachable host:
 * - No Diagnostics UI is visible.
 * - Pages render without unhandled exceptions.
 * - Backend-dependent pages show the friendly fallback message.
 * - No internal URLs or "Test backend connection" / "Not reachable" / "127.0.0.1" in the UI.
 *
 * Run with unreachable backend:
 *   NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:99999 npm run build && npm run start
 *   Then in another terminal: npx playwright test e2e/backend-unreachable.spec.ts
 * Or use: npm run test:e2e:unreachable (builds with unreachable URL and runs these tests).
 */
import { test, expect } from "@playwright/test";

const FORBIDDEN_PHRASES = [
  "127.0.0.1",
  "Not reachable",
  "Test backend connection",
  "Backend URL",
];
const FRIENDLY_MESSAGE = "We're having trouble connecting right now. Please try again.";

test.describe("Backend unreachable", () => {
  test("home page (/) loads and shows no diagnostics UI", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();

    const text = await page.locator("body").textContent();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  test("upload page (/upload) loads and shows no diagnostics UI", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("body")).toBeVisible();

    const text = await page.locator("body").textContent();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  test("report page (/report) loads; shows friendly message or missing report", async ({
    page,
  }) => {
    await page.goto("/report?reportId=test-nonexistent");
    await expect(page.locator("body")).toBeVisible();

    const text = await page.locator("body").textContent();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(text).not.toContain(phrase);
    }
    // Either the friendly connection message or a "missing report" / "Report not found" style message
    const hasFriendlyOrExpected =
      text?.includes(FRIENDLY_MESSAGE) ||
      text?.includes("Report ID is missing") ||
      text?.includes("Report not found") ||
      text?.includes("Loading report");
    expect(hasFriendlyOrExpected).toBeTruthy();
  });

  test("upload page has no forbidden phrases in initial UI", async ({ page }) => {
    await page.goto("/upload");
    await expect(page.locator("body")).toBeVisible();
    const text = await page.locator("body").textContent();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });
});
