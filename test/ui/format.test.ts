import { describe, expect, it } from "bun:test";
import { truncate, shortenId, formatCount } from "../../src/ui/format.ts";

describe("ui format", () => {
  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 7)).toBe("hello …");
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("shortens long IDs with ellipsis", () => {
    expect(shortenId("abc123def456")).toContain("…");
    expect(shortenId("short")).toBe("short");
  });

  it("formats counts with singular and plural", () => {
    expect(formatCount(1, "item")).toBe("1 item");
    expect(formatCount(2, "item")).toBe("2 items");
    expect(formatCount(0, "preset")).toBe("0 presets");
  });
});
