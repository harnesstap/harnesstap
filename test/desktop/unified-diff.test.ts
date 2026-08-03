import { describe, expect, it } from "bun:test";
import { buildUnifiedDiffLines } from "../../apps/desktop/src/lib/unified-diff.ts";

describe("buildUnifiedDiffLines", () => {
  it("emits git-style +/- lines for a simple change", () => {
    const lines = buildUnifiedDiffLines(
      "file.txt",
      "alpha\nbeta\ngamma\n",
      "alpha\nBETA\ngamma\n",
    );
    const texts = lines.map((line) => line.text);
    expect(texts[0]).toBe("--- a/file.txt");
    expect(texts[1]).toBe("+++ b/file.txt");
    expect(texts.some((text) => text.startsWith("@@ "))).toBe(true);
    expect(texts).toContain("-beta");
    expect(texts).toContain("+BETA");
    expect(texts).toContain(" alpha");
    expect(texts).toContain(" gamma");
  });

  it("treats missing current as empty file", () => {
    const lines = buildUnifiedDiffLines("gone.txt", "one\ntwo\n", null);
    const texts = lines.map((line) => line.text);
    expect(texts).toContain("-one");
    expect(texts).toContain("-two");
    expect(texts.every((text) => !text.startsWith("+") || text.startsWith("+++"))).toBe(
      true,
    );
  });

  it("reports when contents match", () => {
    const lines = buildUnifiedDiffLines("same.txt", "x\n", "x\n");
    expect(lines.map((line) => line.text)).toContain("(no content differences)");
  });
});
