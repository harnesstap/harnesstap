import { describe, expect, it } from "bun:test";
import { parseFrontmatter, parseFrontmatterLenient } from "../../src/utils/frontmatter.ts";

describe("parseFrontmatter", () => {
  it("reports invalid YAML every time the same text is parsed", () => {
    const text = "---\nname: colon-desc\ndescription: a: b: c\n---\n# Body\n";
    expect(() => parseFrontmatter(text)).toThrow();
    // gray-matter's cache returned an empty result here instead of throwing.
    expect(() => parseFrontmatter(text)).toThrow();
  });

  it("returns a fresh result each call, so callers cannot share data", () => {
    const text = "---\nname: shared\n---\n# Body\n";
    const first = parseFrontmatter(text);
    (first.data as Record<string, unknown>).name = "changed";
    expect(parseFrontmatter(text).data).toEqual({ name: "shared" });
  });
});

describe("parseFrontmatterLenient", () => {
  it("reads an unquoted value with a colon as a string, as Claude Code does", () => {
    const text =
      "---\nname: mem-search\ndescription: Search in three steps: search, timeline, then get.\n---\n\n# Smart Search\n";
    const parsed = parseFrontmatterLenient(text);
    expect(parsed.data).toEqual({
      name: "mem-search",
      description: "Search in three steps: search, timeline, then get.",
    });
    expect(parsed.content.trim()).toBe("# Smart Search");
  });

  it("parses valid YAML exactly like parseFrontmatter", () => {
    const text = "---\nname: ok\ntags:\n  - a\n---\n# Body\n";
    expect(parseFrontmatterLenient(text).data).toEqual(parseFrontmatter(text).data);
  });

  it("still throws for YAML that is not flat key: value lines", () => {
    expect(() => parseFrontmatterLenient("---\nname: x\n  bad: indent: here\n---\n# Body\n")).toThrow();
    expect(() => parseFrontmatterLenient("---\nname: [unclosed: list\n---\n# Body\n")).toThrow();
  });
});
