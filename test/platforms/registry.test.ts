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
    expect(copilotCli?.globalPaths.plugins).toBe("~/.copilot/installed-plugins/");
    expect(copilotCli?.globalPaths.pathAlternates?.settings).toEqual([
      "~/.copilot/settings.json",
    ]);
  });

  it("includes kiro and pi harness entries", async () => {
    const registry = await import("../../src/platforms/registry.ts");

    const kiro = registry.getPlatform("kiro");
    expect(kiro).toBeDefined();
    expect(kiro?.projectPaths.rules).toBe(".kiro/steering/");
    expect(kiro?.projectPaths.skills).toBe(".agents/skills/");
    expect(kiro?.globalPaths.skills).toBe("~/.kiro/skills/");
    expect(kiro?.supports.has("rules")).toBe(true);

    const pi = registry.getPlatform("pi");
    expect(pi).toBeDefined();
    expect(pi?.projectPaths.instructions).toBe("AGENTS.md");
    expect(pi?.projectPaths.skills).toBe(".agents/skills/");
    expect(pi?.supports.has("rules")).toBe(false);
  });

  it("includes newly added top harnesses", async () => {
    const registry = await import("../../src/platforms/registry.ts");

    const antigravity = registry.getPlatform("antigravity");
    expect(antigravity).toBeDefined();
    expect(antigravity?.projectPaths.rules).toBe(".agents/rules/");
    expect(antigravity?.projectPaths.commands).toBe(".agents/workflows/");
    expect(antigravity?.projectPaths.mcp).toBe(".agents/mcp_config.json");
    expect(antigravity?.globalPaths.instructions).toBe("~/.gemini/GEMINI.md");
    expect(antigravity?.supports.has("commands")).toBe(true);

    const amazonQ = registry.getPlatform("amazon-q");
    expect(amazonQ?.projectPaths.rules).toBe(".amazonq/rules/");
    expect(amazonQ?.projectPaths.mcp).toBe(".amazonq/mcp.json");
    expect(amazonQ?.projectPaths.instructions).toBe("AmazonQ.md");

    const aider = registry.getPlatform("aider");
    expect(aider?.projectPaths.instructions).toBe("CONVENTIONS.md");
    expect(aider?.projectPaths.settings).toBe(".aider.conf.yml");

    const zed = registry.getPlatform("zed");
    expect(zed?.globalPaths.instructions).toBe("~/.config/zed/AGENTS.md");
    expect(zed?.projectPaths.pathAlternates?.instructions).toContain(".rules");

    const devin = registry.getPlatform("devin");
    expect(devin?.projectPaths.settings).toBe(".devin/config.json");
    expect(devin?.globalPaths.instructions).toBe("~/.config/devin/AGENTS.md");

    const jules = registry.getPlatform("jules");
    expect(jules?.projectPaths.pathAlternates?.instructions).toContain("JULES.md");

    const cody = registry.getPlatform("cody");
    expect(cody?.projectPaths.settings).toBe("cody.json");
    expect(cody?.globalPaths.settings).toBe("~/.config/sourcegraph/cody.json");

    const grok = registry.getPlatform("grok-build");
    expect(grok?.projectPaths.skills).toBe(".grok/skills/");
    expect(grok?.projectPaths.settings).toBe(".grok/config.toml");
    expect(grok?.projectPaths.agents).toBe(".grok/agents/");
    expect(grok?.projectPaths.hooks).toBe(".grok/hooks/");
    expect(grok?.supports.has("mcp")).toBe(true);
    expect(grok?.supports.has("permissions")).toBe(true);
    expect(grok?.supports.has("hooks")).toBe(true);
    expect(grok?.supports.has("agents")).toBe(true);
    expect(grok?.supports.has("commands")).toBe(true);
    expect(grok?.supports.has("model_config")).toBe(true);

    const dsh = registry.getPlatform("deepseek-harness");
    expect(dsh?.name).toBe("DeepSeek Harness");
    expect(dsh?.projectPaths.skills).toBe(".dsh/skills/");
    expect(dsh?.projectPaths.hooks).toBe(".dsh/hooks/");
    expect(dsh?.projectPaths.pathAlternates?.skills).toEqual([".agents/skills/"]);
    expect(dsh?.projectPaths.pathAlternates?.instructions).toBeUndefined();
    expect(dsh?.globalPaths.mcp).toBe("~/.dsh/cordis.patch.yml");
    expect(dsh?.globalPaths.settings).toBe("~/.dsh/settings.yaml");
    expect(dsh?.globalPaths.agents).toBe("~/.dsh/.agent-presets/");
    expect(dsh?.globalPaths.plugins).toBe("~/.dsh/profiles/web/");
    expect(dsh?.supports.has("mcp")).toBe(true);
    expect(dsh?.supports.has("hooks")).toBe(true);
    expect(dsh?.supports.has("agents")).toBe(true);
    expect(dsh?.supports.has("permissions")).toBe(true);
    expect(dsh?.supports.has("model_config")).toBe(true);
    expect(dsh?.supports.has("commands")).toBe(false);
    expect(dsh?.supports.has("rules")).toBe(false);

    const muse = registry.getPlatform("muse-code");
    expect(muse?.name).toBe("Muse Code");
    expect(muse?.projectPaths.instructions).toBe("AGENTS.md");
    expect(muse?.projectPaths.skills).toBe(".agents/skills/");
    expect(muse?.projectPaths.hooks).toBe(".muse/hooks.json");
    expect(muse?.projectPaths.mcp).toBeUndefined();
    expect(muse?.globalPaths.settings).toBe("~/.config/muse/settings.json");
    expect(muse?.globalPaths.mcp).toBe("~/.config/muse/settings.json");
    expect(muse?.globalPaths.skills).toBe("~/.config/muse/skills/");
    expect(muse?.globalPaths.pathAlternates?.settings).toEqual(["~/.config/muse/"]);
    expect(muse?.supports.has("mcp")).toBe(true);
    expect(muse?.supports.has("hooks")).toBe(true);
    expect(muse?.supports.has("skills")).toBe(true);
    expect(muse?.supports.has("instructions")).toBe(true);
    expect(muse?.supports.has("agents")).toBe(false);
    expect(muse?.supports.has("commands")).toBe(false);

    expect(registry.getAllPlatforms().length).toBe(43);
  });

  it("detectPlatforms returns empty array (stub)", async () => {
    const registry = await import("../../src/platforms/registry.ts");
    expect(registry.detectPlatforms("/some/path")).toEqual([]);
  });
});
