import { describe, expect, it } from "bun:test";
import { renderHeader, renderSubheader, renderRule } from "../../src/ui/section.ts";

describe("ui section", () => {
  it("renderHeader returns a string containing the title", () => {
    expect(renderHeader("My Title")).toContain("My Title");
  });

  it("renderSubheader returns a string containing the subtitle", () => {
    expect(renderSubheader("Overview")).toContain("Overview");
  });

  it("renderRule returns a separator containing the box-drawing character", () => {
    const rule = renderRule();
    expect(rule).toContain("─");
  });
});
