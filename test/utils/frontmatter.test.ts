import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "../../src/utils/frontmatter.ts";

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
