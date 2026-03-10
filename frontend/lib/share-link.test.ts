import { describe, expect, it, vi } from "vitest";
import { buildShareUrl, decodeSharePayload, encodeSharePayload } from "@/lib/share-link";

describe("share-link", () => {
  it("encodes and decodes structured payload", () => {
    const win = {
      btoa: (v: string) => Buffer.from(v, "binary").toString("base64"),
      atob: (v: string) => Buffer.from(v, "base64").toString("binary"),
      location: { origin: "https://thecremodel.com" },
    } as unknown as Window;
    vi.stubGlobal("window", win);

    const payload = { version: 1, title: "Survey", ids: ["a", "b"] };
    const encoded = encodeSharePayload(payload);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeSharePayload<typeof payload>(encoded);
    expect(decoded).toEqual(payload);

    const url = buildShareUrl("/surveys/share", encoded);
    expect(url.startsWith("https://thecremodel.com/surveys/share?data=")).toBe(true);

    vi.unstubAllGlobals();
  });

  it("returns null when payload is invalid", () => {
    const win = {
      btoa: (v: string) => Buffer.from(v, "binary").toString("base64"),
      atob: () => {
        throw new Error("invalid");
      },
      location: { origin: "https://thecremodel.com" },
    } as unknown as Window;
    vi.stubGlobal("window", win);

    const decoded = decodeSharePayload<{ foo: string }>("broken");
    expect(decoded).toBeNull();

    vi.unstubAllGlobals();
  });
});
