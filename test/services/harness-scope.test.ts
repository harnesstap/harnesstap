import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  setPluginResourceHarnessScope,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { generateFiles } from "../../src/services/applier.ts";
import {
  linkedHarnessGroups,
  normalizeScopeToRegistered,
  parseHarnessScope,
  serializeHarnessScope,
} from "../../src/services/harness-scope.ts";
import { getAllPlatforms } from "../../src/platforms/registry.ts";

function createSkill(name: string, content: string) {
  return createResource({
    type: "skill",
    name,
    description: `${name} skill`,
    content,
    metadata: {},
    source: "manual",
  });
}

describe("harness-scope", () => {
  it("treats missing and empty as All", () => {
    expect(parseHarnessScope(undefined).kind).toBe("all");
    expect(parseHarnessScope("all").kind).toBe("all");
    expect(serializeHarnessScope(parseHarnessScope(["claude-code"]))).toBe(
      JSON.stringify(["claude-code"]),
    );
  });

  it("normalizes a full registered list to All", () => {
    const scope = parseHarnessScope(["cursor", "claude-code"]);
    expect(normalizeScopeToRegistered(scope, ["claude-code", "cursor"]).kind).toBe("all");
  });

  it("groups harnesses that share a native folder per resource type", () => {
    const platforms = getAllPlatforms().map((platform) => platform.id);
    const globalSkills = linkedHarnessGroups(platforms, "skill", "global")
      .filter((group) => group.linked)
      .map((group) => ({
        path: group.emitPath,
        harnesses: [...group.harnessIds].sort(),
      }));
    const projectSkills = linkedHarnessGroups(platforms, "skill", "project")
      .filter((group) => group.linked)
      .map((group) => ({
        path: group.emitPath,
        harnesses: [...group.harnessIds].sort(),
      }));
    const projectInstructions = linkedHarnessGroups(platforms, "instruction", "project")
      .filter((group) => group.linked)
      .map((group) => ({
        path: group.emitPath,
        harnesses: [...group.harnessIds].sort(),
      }));

    expect(globalSkills.some((group) => group.path === "~/.agents/skills")).toBe(true);
    const agentsGlobal = globalSkills.find((group) => group.path === "~/.agents/skills");
    expect(agentsGlobal?.harnesses).toEqual(expect.arrayContaining(["codex", "cline", "goose"]));
    expect(agentsGlobal?.harnesses).not.toContain("cursor");
    expect(agentsGlobal?.harnesses).not.toContain("claude-code");

    const agentsProject = projectSkills.find((group) => group.path === ".agents/skills");
    expect(agentsProject).toBeDefined();
    expect(agentsProject?.harnesses).toEqual(expect.arrayContaining(["codex", "cursor"]));
    expect(agentsProject?.harnesses).not.toContain("claude-code");

    const agentsMd = projectInstructions.find((group) => group.path === "AGENTS.md");
    expect(agentsMd).toBeDefined();
    expect(agentsMd?.harnesses).toEqual(expect.arrayContaining(["codex", "cursor"]));
    expect(agentsMd?.harnesses).not.toContain("claude-code");
  });
});

describe("scoped profile apply", () => {
  it("writes a subset skill only to scoped harnesses", async () => {
    const context = await createInitializedTestContext("harness-scope-apply");
    try {
      setHarnessPreference({
        registered_harnesses: ["claude-code", "cursor", "codex"],
      });
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const skill = createSkill("only-claude", "# Only Claude");
      addResourceToPlugin(plugin.id, skill.id);
      setPluginResourceHarnessScope(plugin.id, skill.id, {
        kind: "subset",
        harnesses: ["claude-code"],
      });

      await applyProfilePlugin("work", {
        conflictPolicy: "replace",
      });

      expect(existsSync(join(context.homeDir, ".claude/skills/only-claude/SKILL.md"))).toBe(true);
      expect(existsSync(join(context.homeDir, ".cursor/skills/only-claude/SKILL.md"))).toBe(false);
      expect(existsSync(join(context.homeDir, ".agents/skills/only-claude/SKILL.md"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("keeps All as a sentinel and still writes every harness", async () => {
    const context = await createInitializedTestContext("harness-scope-all");
    try {
      setHarnessPreference({
        registered_harnesses: ["claude-code", "codex"],
      });
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const skill = createSkill("everywhere", "# All");
      addResourceToPlugin(plugin.id, skill.id);
      const attached = getPluginResources(plugin.id)[0];
      expect(attached?.harness_scope?.kind).toBe("all");

      const generated = await generateFiles(
        getPluginResources(plugin.id),
        ["claude-code", "codex"],
        context.homeDir,
        { target: "global" },
      );
      const claude = generated.find((result) => result.platformId === "claude-code");
      const codex = generated.find((result) => result.platformId === "codex");
      expect(claude?.files.some((file) => file.path.includes("everywhere"))).toBe(true);
      expect(codex?.files.some((file) => file.path.includes("everywhere"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("normalizes checking every registered harness to All", async () => {
    const context = await createInitializedTestContext("harness-scope-normalize");
    try {
      setHarnessPreference({
        registered_harnesses: ["claude-code", "cursor"],
      });
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const skill = createSkill("full", "# Full");
      addResourceToPlugin(plugin.id, skill.id, {
        kind: "subset",
        harnesses: ["claude-code", "cursor"],
      });
      setPluginResourceHarnessScope(
        plugin.id,
        skill.id,
        normalizeScopeToRegistered(
          parseHarnessScope(["cursor", "claude-code"]),
          ["claude-code", "cursor"],
        ),
      );
      expect(getPluginResources(plugin.id)[0]?.harness_scope?.kind).toBe("all");
    } finally {
      await context.cleanup();
    }
  });

  it("writes linked shared-folder project skills through one scoped group", async () => {
    const context = await createInitializedTestContext("harness-scope-linked");
    try {
      setHarnessPreference({
        registered_harnesses: ["claude-code", "cursor", "codex"],
      });
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const skill = createSkill("shared-folder", "# Shared");
      addResourceToPlugin(plugin.id, skill.id);
      const linked = linkedHarnessGroups(
        ["claude-code", "cursor", "codex"],
        "skill",
        "project",
      ).find((group) => group.linked && group.emitPath === ".agents/skills");
      expect(linked?.harnessIds).toEqual(expect.arrayContaining(["codex", "cursor"]));
      setPluginResourceHarnessScope(plugin.id, skill.id, {
        kind: "subset",
        harnesses: [...(linked?.harnessIds ?? ["cursor", "codex"])],
      });

      const generated = await generateFiles(
        getPluginResources(plugin.id),
        ["claude-code", "cursor", "codex"],
        context.homeDir,
        { target: "project" },
      );
      const cursor = generated.find((result) => result.platformId === "cursor");
      const codex = generated.find((result) => result.platformId === "codex");
      const claude = generated.find((result) => result.platformId === "claude-code");
      expect(cursor?.files.some((file) => file.path.includes("shared-folder"))).toBe(true);
      expect(codex?.files.some((file) => file.path.includes("shared-folder"))).toBe(true);
      expect(claude?.files.some((file) => file.path.includes("shared-folder"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
