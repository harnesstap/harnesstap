import { describe, expect, it } from "bun:test";
import {
  formatAbsoluteTime,
  truncate,
  shortenId,
  formatCount,
  formatRelativeTimeWithAbsolute,
} from "../../src/ui/format.ts";

describe("ui format", () => {
  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello world", 7)).toBe("hell...");
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("shortens long IDs with ellipsis", () => {
    expect(shortenId("abc123def456")).toBe("abc1...f456");
    expect(shortenId("short")).toBe("short");
  });

  it("formats counts with singular and plural", () => {
    expect(formatCount(1, "item")).toBe("1 item");
    expect(formatCount(2, "item")).toBe("2 items");
    expect(formatCount(0, "plugin")).toBe("0 plugins");
  });

  it("uses singular units for one second", () => {
    const justNow = new Date(Date.now() - 1000);
    expect(formatRelativeTimeWithAbsolute(justNow)).toContain("1 second ago");
  });

  it("formats relative time with absolute date and time in parentheses", () => {
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    const absolute = formatAbsoluteTime(elevenDaysAgo, { includeTime: true });
    expect(formatRelativeTimeWithAbsolute(elevenDaysAgo)).toBe(`11 days ago (${absolute})`);
  });

  it("formats absolute times in the local time zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Pacific/Tahiti";
    try {
      expect(formatAbsoluteTime("2026-01-02T00:00:00.000Z", { includeTime: true })).toBe(
        "2026-01-01 14:00:00",
      );
      expect(formatAbsoluteTime("2026-01-02T00:00:00.000Z")).toBe("2026-01-01");
    } finally {
      // bun test runs in UTC unless TZ is set; deleting TZ would not reset it.
      process.env.TZ = previous ?? "UTC";
    }
  });
});
