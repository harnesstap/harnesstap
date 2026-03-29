import { describe, expect, it } from "vitest";

describe("platform registry", () => {
  it("returns known platforms and their capabilities", async () => {
    const registry = await import("../../src/platforms/registry.ts");

    const claude = registry.getPlatform("claude-code");
    const cursor = registry.getPlatform("cursor");
    const codex = registry.getPlatform("codex");
    const warp = registry.getPlatform("warp");

    expect(claude?.supports.has("commands")).toBe(true);
    expect(cursor?.projectPaths.rules).toBe(".cursor/rules/");
    expect(codex?.projectPaths.agents).toBe(".codex/agents/");
    expect(codex?.supports.has("hooks")).toBe(true);
    expect(warp?.projectPaths.instructions).toBe("AGENTS.md");
    expect(warp?.projectPaths.skills).toBe(".agents/skills/");
    expect(registry.getPlatformIds()).toEqual(
      expect.arrayContaining(["claude-code", "codex", "cursor", "warp"]),
    );
    expect(registry.getAllPlatforms().length).toBeGreaterThan(10);
  });
});
