import { describe, expect, it } from "bun:test";
import {
  RESOURCE_CONTENT_PREVIEW_LINES,
  previewResourceContent,
} from "../../apps/desktop/src/lib/resource-content-preview.ts";

describe("previewResourceContent", () => {
  it("keeps the CLI default of 15 lines", () => {
    expect(RESOURCE_CONTENT_PREVIEW_LINES).toBe(15);
  });

  it("truncates content after 15 lines with a total line count", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const truncated = previewResourceContent(lines.join("\n"));

    expect(truncated.split("\n")).toHaveLength(16);
    expect(truncated).toContain("line 15");
    expect(truncated).not.toContain("line 16");
    expect(truncated).toContain("… (20 lines in content)");
  });

  it("keeps short content unchanged", () => {
    const content = "line 1\nline 2\nline 3";
    expect(previewResourceContent(content)).toBe(content);
  });
});
