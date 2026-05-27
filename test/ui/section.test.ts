import { describe, expect, it, beforeEach } from "bun:test";
import { renderHeader, renderSubheader, renderRule } from "../../src/ui/section.ts";
import { disableColor, theme } from "../../src/ui/theme.ts";

describe("ui section", () => {
  beforeEach(() => {
    // Enable colors for tests
    delete process.env.NO_COLOR;
  });

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

  it("uses heading role for headers", () => {
    const header = renderHeader("Projects");
    const expected = theme.heading("Projects");
    expect(header).toBe(expected);
  });

  it("uses label role for subheaders", () => {
    const subheader = renderSubheader("Available");
    const expected = theme.label("Available");
    expect(subheader).toBe(expected);
  });

  it("uses border role for rules", () => {
    const rule = renderRule();
    // Rule should use border styling
    expect(rule).toContain("─");
    // Verify it uses border role by checking it matches themed output
    const expectedChar = theme.border("─");
    expect(rule).toContain(expectedChar);
  });

  it("degrades to plain text when NO_COLOR is set", () => {
    disableColor();
    const header = renderHeader("Test");
    const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
    expect(header).not.toMatch(ansiEscapeRegex);
    expect(header).toBe("Test");
  });
});
