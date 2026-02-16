/**
 * Fails the build if any UI contains forbidden production strings.
 * Run after build (e.g. in CI): npm run build && npm run start & then npx playwright test e2e/forbidden-strings.spec.ts
 */
import { test, expect } from "@playwright/test";

const FORBIDDEN_PHRASES = [
  "127.0.0.1",
  "localhost",
  "Diagnostics",
  "Test backend connection",
  "npm run",
  "npx ",
  "curl ",
];

const PAGES = ["/", "/upload", "/example"];

test.describe("Forbidden strings in UI", () => {
  for (const path of PAGES) {
    test(`${path} does not show forbidden phrases`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();

      const text = await page.locator("body").textContent() ?? "";
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text, `Page ${path} must not contain "${phrase}"`).not.toContain(phrase);
      }
    });
  }
});
