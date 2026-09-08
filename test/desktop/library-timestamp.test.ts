import { describe, expect, it } from "bun:test";
import {
  formatLastEditLine,
  formatLibraryTimestamp,
} from "../../apps/desktop/src/lib/library-timestamp.ts";

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

describe("formatLastEditLine", () => {
  it("uses just now for edits under a minute", () => {
    const edited = new Date(2026, 8, 7, 14, 32, 5);
    const now = new Date(2026, 8, 7, 14, 32, 20);
    expect(formatLastEditLine(edited.toISOString(), { now })).toBe(
      "Last edit just now (2026/09/07 14:32:05)",
    );
  });

  it("uses minutes, then days, with local YYYY/MM/DD HH:MM:SS", () => {
    const edited = new Date(2026, 8, 7, 14, 32, 5);
    expect(
      formatLastEditLine(edited.toISOString(), {
        now: new Date(2026, 8, 7, 14, 37, 5),
      }),
    ).toBe("Last edit 5 minutes ago (2026/09/07 14:32:05)");
    expect(
      formatLastEditLine(edited.toISOString(), {
        now: new Date(2026, 8, 8, 14, 32, 5),
      }),
    ).toBe("Last edit 1 day ago (2026/09/07 14:32:05)");
  });

  it("returns null for an invalid timestamp", () => {
    expect(formatLastEditLine("not-a-date")).toBeNull();
  });
});
