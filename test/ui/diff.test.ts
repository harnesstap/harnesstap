import { describe, expect, it } from "vitest";
import { renderDiffTable } from "../../src/ui/diff.ts";

describe("ui diff", () => {
  it("renders diff rows with before and after values", () => {
    const output = renderDiffTable({
      rows: [{ key: "model", before: "claude-3", after: "claude-4" }],
    });
    expect(output).toContain("model");
    expect(output).toContain("claude-3");
    expect(output).toContain("claude-4");
  });

  it("optionally renders a title", () => {
    const output = renderDiffTable({
      rows: [],
      title: "Changes",
    });
    expect(output).toContain("Changes");
  });
});
