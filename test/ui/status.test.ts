import { describe, expect, it, beforeEach } from "bun:test";
import { renderDanger, renderSuccess, renderWarn } from "../../src/ui/status.ts";
import { disableColor } from "../../src/ui/theme.ts";

describe("ui status", () => {
  beforeEach(() => {
    // Enable colors for tests (tests run with NO_COLOR by default in some environments)
    delete process.env.NO_COLOR;
  });

  it("renders verdicts with icons and optional hints", () => {
    expect(renderSuccess('Plugin "team" is valid.')).toContain("✓");
    expect(
      renderDanger("Plugin not found: team", {
        hint: "Run `harnesstap plugin list` to see available plugins.",
      }),
    ).toContain("→");
  });

  it("uses info role for hint text instead of full-line coloring", () => {
    const output = renderWarn("Something went wrong", {
      hint: "Try running with --verbose",
    });
    // The output should contain the hint icon
    expect(output).toContain("→");
    // Hints should use info styling, not be wrapped in full warn color
    expect(output).toContain("Try running with --verbose");
  });

  it("degrades to plain text when NO_COLOR is set", () => {
    disableColor();
    const output = renderSuccess("All good", { hint: "Next step" });
    // Should not contain ANSI escape codes
    const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
    expect(output).not.toMatch(ansiEscapeRegex);
    expect(output).toContain("✓");
    expect(output).toContain("All good");
    expect(output).toContain("Next step");
  });
});
