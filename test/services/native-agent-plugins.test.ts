import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { saveSettings } from "../../src/config/settings.ts";
import { generateFiles } from "../../src/services/applier.ts";
import {
  nativeAgentPluginFiles,
  splitNativeAgentPluginExtract,
} from "../../src/services/native-agent-plugins.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("native-agent-plugins-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function agentSkill(): Resource {
  return makeResource({
    type: "skill",
    name: "demo-skill",
    description: "Demo skill",
    content: "Do the demo.\n",
    metadata: {
      imported_from: {
        source_kind: "local",
        source_label: "demo",
        plugin_name: "demo",
        source_plugin_kind: "agent-plugin",
        relative_path: "skills/demo-skill/SKILL.md",
        imported_at: "2026-10-13T00:00:00.000Z",
      },
    },
  });
}

describe("native agent plugins", () => {
  it("keeps the portable extract when the flag is off", async () => {
    const files = await generateFiles([agentSkill()], ["codex"], ctx.homeDir, {
      target: "project",
    });
    const paths = files[0]?.files.map((file) => file.path) ?? [];
    expect(paths.some((path) => path.endsWith(".agents/skills/demo-skill/SKILL.md"))).toBe(true);
    expect(paths.some((path) => path.includes("native-agent-plugins"))).toBe(false);
  });

  it("registers a Codex package and does not also extract the skill", async () => {
    saveSettings(ctx.connection.getHarnesstapDir(), {
      plugins: {
        refreshMaxAgeHours: 24,
        marketplaceRefreshMaxAgeMinutes: 60,
        marketplaces: [],
      },
      pluginVersionHistoryLimit: 10,
      harnessSync: { pluginResources: "symlink", nativeAgentPlugins: true },
    });
    const first = await generateFiles([agentSkill()], ["codex"], ctx.homeDir, {
      target: "project",
    });
    const paths = first[0]?.files.map((file) => file.path) ?? [];
    expect(paths.some((path) => path.endsWith(".agents/skills/demo-skill/SKILL.md"))).toBe(false);
    expect(paths).toContain(
      ".harnesstap/cache/native-agent-plugins/plugins/demo/skills/demo-skill/SKILL.md",
    );
    expect(paths).toContain(".harnesstap/cache/native-agent-plugins/.agents/plugins/marketplace.json");
    const config = first[0]?.files.find((file) => file.path === ".codex/config.toml")?.content ?? "";
    expect(config).toContain("demo@harnesstap");
    expect(config).toContain("native-agent-plugins/plugins/demo");

    const second = await generateFiles([agentSkill()], ["codex"], ctx.homeDir, {
      target: "project",
    });
    expect(second[0]?.files.find((file) => file.path === ".codex/config.toml")?.content).toBe(config);
  });

  it("removes only our Codex plugin key and keeps the rest", () => {
    const skill = agentSkill();
    const split = splitNativeAgentPluginExtract([skill]);
    const existing = 'model = "gpt-5"\n\n[plugins."other@openai"]\nenabled = true\n';
    const added = nativeAgentPluginFiles({
      platformId: "codex",
      applyRoot: ctx.homeDir,
      groups: split.groups,
      files: [{ path: ".codex/config.toml", content: existing }],
    });
    const config = added.files.find((file) => file.path === ".codex/config.toml")?.content ?? "";
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain("other@openai");
    expect(config).toContain("demo@harnesstap");

    mkdirSync(join(ctx.homeDir, ".codex"), { recursive: true });
    writeFileSync(join(ctx.homeDir, ".codex/config.toml"), config);
    const removed = nativeAgentPluginFiles({
      platformId: "codex",
      applyRoot: ctx.homeDir,
      groups: [],
      files: [],
    });
    const next = removed.files.find((file) => file.path === ".codex/config.toml")?.content ?? "";
    expect(next).toContain('model = "gpt-5"');
    expect(next).toContain("other@openai");
    expect(next).not.toContain("demo@harnesstap");
  });
});
