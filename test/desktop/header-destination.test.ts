import { describe, expect, it } from "bun:test";
import { headerClickIntent } from "../../apps/desktop/src/lib/header-destination.ts";

describe("headerClickIntent", () => {
  it("re-clicking the active tab resets it", () => {
    expect(headerClickIntent("library", "library")).toBe("reset");
    expect(headerClickIntent("discover", "discover")).toBe("reset");
    expect(headerClickIntent("environments", "environments")).toBe("reset");
    expect(headerClickIntent("harnesses", "harnesses")).toBe("reset");
    expect(headerClickIntent("scope", "scope")).toBe("reset");
  });

  it("clicking another tab switches to it", () => {
    expect(headerClickIntent("library", "environments")).toBe("switch");
    expect(headerClickIntent("environments", "harnesses")).toBe("switch");
    expect(headerClickIntent("harnesses", "scope")).toBe("switch");
    expect(headerClickIntent("scope", "library")).toBe("switch");
  });
});
