import { describe, expect, it } from "vitest";
import { renderDanger, renderSuccess } from "../../src/ui/status.ts";

describe("ui status", () => {
  it("renders verdicts with icons and optional hints", () => {
    expect(renderSuccess('Preset "team" is valid.')).toContain("✓");
    expect(
      renderDanger("Preset not found: team", {
        hint: "Run `harnessdeck preset list` to see available presets.",
      }),
    ).toContain("→");
  });
});
