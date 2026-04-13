import { describe, expect, it } from "vitest";
import { isPublicAppPath, shouldRedirectSignedOutVisitor } from "@/lib/auth-access";

describe("auth-access", () => {
  it("keeps public pages reachable while signed out", () => {
    expect(isPublicAppPath("/")).toBe(true);
    expect(isPublicAppPath("/sign-in")).toBe(true);
    expect(isPublicAppPath("/sign-up")).toBe(true);
    expect(isPublicAppPath("/docs")).toBe(false);
  });

  it("redirects signed-out visitors away from protected app routes", () => {
    expect(shouldRedirectSignedOutVisitor("/client", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/branding", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/upload", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/", "financial-analyses")).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/", null)).toBe(false);
    expect(shouldRedirectSignedOutVisitor("/docs", null)).toBe(true);
  });
});
