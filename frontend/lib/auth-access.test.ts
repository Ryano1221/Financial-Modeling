import { describe, expect, it } from "vitest";
import { isPublicAppPath, shouldRedirectSignedOutVisitor } from "@/lib/auth-access";

describe("auth-access", () => {
  it("keeps public pages reachable while signed out", () => {
    expect(isPublicAppPath("/")).toBe(true);
    expect(isPublicAppPath("/docs")).toBe(true);
    expect(isPublicAppPath("/security")).toBe(true);
    expect(isPublicAppPath("/contact")).toBe(true);
    expect(isPublicAppPath("/financial-analyses/share")).toBe(true);
    expect(isPublicAppPath("/report")).toBe(true);
  });

  it("redirects signed-out visitors away from protected app routes", () => {
    expect(shouldRedirectSignedOutVisitor("/client", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/branding", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/upload", null)).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/", "financial-analyses")).toBe(true);
    expect(shouldRedirectSignedOutVisitor("/", null)).toBe(false);
    expect(shouldRedirectSignedOutVisitor("/docs", null)).toBe(false);
  });
});
