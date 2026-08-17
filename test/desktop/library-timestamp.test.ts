import { describe, expect, it } from "bun:test";
import { formatLibraryTimestamp } from "../../apps/desktop/src/lib/library-timestamp.ts";

describe("formatLibraryTimestamp", () => {
  it("renders locale absolute date with relative time in parentheses", () => {
    const iso = "2026-08-03T01:10:45.955Z";
    const now = new Date("2026-08-15T12:00:00.000Z");
    const formatted = formatLibraryTimestamp(iso, { now, locale: "en-US" });
    expect(formatted).toMatch(/\(12 days ago\)$/);
    expect(formatted.startsWith("Aug")).toBe(true);
    expect(formatted).toContain("2026");
    expect(formatted).toContain("(");
  });

  it("returns the raw string when the timestamp is not a valid date", () => {
    expect(formatLibraryTimestamp("not-a-date")).toBe("not-a-date");
  });
});
