import { describe, expect, it } from "bun:test";

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

  it("returns undefined for unknown platform", async () => {
    const registry = await import("../../src/platforms/registry.ts");
    expect(registry.getPlatform("unknown-platform")).toBeUndefined();
  });

  it("returns an independent copy of platforms", async () => {
    const registry = await import("../../src/platforms/registry.ts");
    const platforms = registry.getAllPlatforms();
    const ids = platforms.map((p) => p.id);

    // Mutating the returned array should not affect subsequent calls
    platforms.length = 0;

    const nextPlatforms = registry.getAllPlatforms();
    expect(nextPlatforms.length).toBeGreaterThan(0);
    expect(nextPlatforms.map((p) => p.id)).toEqual(ids);
  });

  it("includes opencode and copilot platforms", async () => {
    const registry = await import("../../src/platforms/registry.ts");

    const opencode = registry.getPlatform("opencode");
    expect(opencode).toBeDefined();
    expect(opencode?.projectPaths.instructions).toBe("AGENTS.md");
    expect(opencode?.projectPaths.mcp).toBe("opencode.json");

    const githubCopilot = registry.getPlatform("github-copilot");
    expect(githubCopilot).toBeDefined();
    expect(githubCopilot?.projectPaths.instructions).toBe(".github/copilot-instructions.md");

    const copilotCli = registry.getPlatform("copilot-cli");
    expect(copilotCli).toBeDefined();
    expect(copilotCli?.projectPaths.instructions).toBe("AGENTS.md");
    expect(copilotCli?.projectPaths.mcp).toBe(".copilot/mcp-config.json");
  });

  it("detectPlatforms returns empty array (stub)", async () => {
    const registry = await import("../../src/platforms/registry.ts");
    expect(registry.detectPlatforms("/some/path")).toEqual([]);
  });
});
