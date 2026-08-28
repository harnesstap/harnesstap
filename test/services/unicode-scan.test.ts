import { describe, expect, it } from "bun:test";
import {
  hasCriticalUnicode,
  scanUnicodeText,
  stripHiddenUnicode,
  summarizeUnicodeFindings,
} from "../../src/services/unicode-scan.ts";

describe("scanUnicodeText", () => {
  it("returns nothing for ASCII", () => {
    expect(scanUnicodeText("hello world\n")).toEqual([]);
  });

  it("flags bidi overrides as critical", () => {
    const findings = scanUnicodeText(`visible\u202Ehidden`, "agents/x.md");
    expect(hasCriticalUnicode(findings)).toBe(true);
    expect(findings[0]?.codepoint).toBe("U+202E");
    expect(findings[0]?.file).toBe("agents/x.md");
    expect(summarizeUnicodeFindings(findings).critical).toBe(1);
  });

  it("flags tag characters as critical", () => {
    const findings = scanUnicodeText(`x${String.fromCodePoint(0xe0041)}y`);
    expect(findings[0]?.category).toBe("tag-character");
    expect(findings[0]?.severity).toBe("critical");
  });

  it("flags zero-width space as warning", () => {
    const findings = scanUnicodeText("a\u200Bb");
    expect(findings[0]?.severity).toBe("warning");
    expect(hasCriticalUnicode(findings)).toBe(false);
  });

  it("downgrades ZWJ inside an emoji sequence to info", () => {
    const family = "👨‍👩‍👧";
    const findings = scanUnicodeText(family);
    const zwj = findings.filter((finding) => finding.codepoint === "U+200D");
    expect(zwj.length).toBeGreaterThan(0);
    expect(zwj.every((finding) => finding.severity === "info")).toBe(true);
  });
});

describe("stripHiddenUnicode", () => {
  it("removes critical and warning characters and preserves emoji ZWJ", () => {
    const family = "👨‍👩‍👧";
    const stripped = stripHiddenUnicode(`keep\u202Esecret\u200B${family}`);
    expect(stripped.text).toBe(`keepsecret${family}`);
    expect(stripped.removed).toBe(2);
  });
});
