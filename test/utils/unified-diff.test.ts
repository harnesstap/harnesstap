import { describe, expect, it } from "bun:test";
import {
  buildUnifiedDiffLines,
  countUnifiedDiffChanges,
} from "../../src/utils/unified-diff.ts";

describe("buildUnifiedDiffLines", () => {
  it("labels sides as live → after-apply", () => {
    const lines = buildUnifiedDiffLines(
      "file.txt",
      "alpha\nbeta\ngamma\n",
      "alpha\nBETA\ngamma\n",
    );
    const texts = lines.map((line) => line.text);
    expect(texts[0]).toBe("--- live/file.txt");
    expect(texts[1]).toBe("+++ after-apply/file.txt");
    expect(texts.some((text) => text.startsWith("@@ "))).toBe(true);
    expect(texts).toContain("-beta");
    expect(texts).toContain("+BETA");
    expect(texts).toContain(" alpha");
    expect(texts).toContain(" gamma");
  });

  it("treats empty live content as a create (all additions)", () => {
    const lines = buildUnifiedDiffLines("gone.txt", "", "one\ntwo\n");
    const texts = lines.map((line) => line.text);
    expect(texts).toContain("+one");
    expect(texts).toContain("+two");
    expect(texts.every((text) => !text.startsWith("-") || text.startsWith("---"))).toBe(
      true,
    );
  });

  it("reports when contents match", () => {
    const lines = buildUnifiedDiffLines("same.txt", "x\n", "x\n");
    expect(lines.map((line) => line.text)).toContain("(no content differences)");
  });
});

describe("countUnifiedDiffChanges", () => {
  it("counts added and removed content lines", () => {
    const lines = buildUnifiedDiffLines(
      "file.txt",
      "keep\ngone\n",
      "keep\nnew\n",
    );
    expect(countUnifiedDiffChanges(lines)).toEqual({ added: 1, removed: 1 });
  });
});
