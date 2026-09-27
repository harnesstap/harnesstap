import { describe, expect, it } from "bun:test";
import {
  httpUrlOrNull,
  isHttpUrl,
} from "../../apps/desktop/src/lib/external-url.ts";

describe("external URL helpers", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("https://github.com/obra/superpowers")).toBe(true);
    expect(isHttpUrl(" http://example.com/path ")).toBe(true);
    expect(httpUrlOrNull("https://github.com/obra/superpowers")).toBe(
      "https://github.com/obra/superpowers",
    );
  });

  it("rejects non-http schemes and junk", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("file:///tmp/plugin")).toBe(false);
    expect(isHttpUrl("github.com/obra/superpowers")).toBe(false);
    expect(httpUrlOrNull("")).toBeNull();
    expect(httpUrlOrNull("  ")).toBeNull();
    expect(httpUrlOrNull(null)).toBeNull();
  });
});
