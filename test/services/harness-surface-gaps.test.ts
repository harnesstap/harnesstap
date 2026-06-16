import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  detectHarnessSurfaces,
  mirrorSurfaceWarnings,
} from "../../src/services/harness-surface-gaps.ts";

const fixtureRoot = join(import.meta.dirname, "../fixtures/ponytail");

describe("harness-surface-gaps", () => {
  it("detects gemini extension manifest surfaces", () => {
    const surfaces = detectHarnessSurfaces(join(fixtureRoot, "gemini"));
    expect(
      surfaces.some((surface) => surface.category === "gemini-extension"),
    ).toBe(true);
  });

  it("warns when alias harnesses cannot receive a harness-specific surface", () => {
    const surfaces = detectHarnessSurfaces(join(fixtureRoot, "gemini"));
    const warnings = mirrorSurfaceWarnings(surfaces, ["codex", "cursor"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.alias_harnesses).toContain("codex");
  });

  it("detects OpenCode .js server plugins", () => {
    const surfaces = detectHarnessSurfaces(
      join(import.meta.dirname, "../fixtures/superpowers/minimal"),
    );
    expect(
      surfaces.some(
        (s) =>
          s.category === "opencode-server-plugin" && s.path.endsWith(".js"),
      ),
    ).toBe(true);
  });
});
