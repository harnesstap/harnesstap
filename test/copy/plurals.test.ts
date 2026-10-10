import { describe, expect, it } from "bun:test";
import { formatCount, pluralNoun } from "../../src/copy/plurals.ts";
import { formatCount as desktopFormatCount } from "../../apps/desktop/src/lib/plurals.ts";

describe("shared plural helper (W3-2)", () => {
  it("formats counts for CLI and Desktop mirrors", () => {
    expect(formatCount(1, "plugin")).toBe("1 plugin");
    expect(formatCount(0, "plugin")).toBe("0 plugins");
    expect(formatCount(2, "remote plugin")).toBe("2 remote plugins");
    expect(formatCount(1, "source")).toBe("1 source");
    expect(formatCount(1, "resource")).toBe("1 resource");
    expect(formatCount(1, "file")).toBe("1 file");
    expect(formatCount(1, "skill")).toBe("1 skill");
    expect(desktopFormatCount(1, "second")).toBe("1 second");
    expect(desktopFormatCount(2, "minute")).toBe("2 minutes");
  });

  it("returns the noun without the count", () => {
    expect(pluralNoun(1, "file")).toBe("file");
    expect(pluralNoun(3, "file")).toBe("files");
  });
});
