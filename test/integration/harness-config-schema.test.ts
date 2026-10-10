import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResource } from "../helpers/resources.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { generateFiles, writeFiles } from "../../src/services/applier.ts";
import { useProfileCommand } from "../../src/services/profile-commands.ts";
import { commandReferencesPluginRoot } from "../../src/services/hook-serialization.ts";

function assertClaudeHooksWrapped(hooks: unknown): void {
  expect(hooks && typeof hooks === "object" && !Array.isArray(hooks)).toBe(true);
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries as unknown[]) {
      expect(entry && typeof entry === "object" && !Array.isArray(entry)).toBe(true);
      const record = entry as Record<string, unknown>;
      expect(Array.isArray(record.hooks)).toBe(true);
    }
  }
}

function assertCursorHooksFlat(document: unknown): void {
  expect(document && typeof document === "object" && !Array.isArray(document)).toBe(true);
  const hooks = (document as { hooks?: unknown }).hooks;
  expect(hooks && typeof hooks === "object" && !Array.isArray(hooks)).toBe(true);
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries as unknown[]) {
      expect(entry && typeof entry === "object" && !Array.isArray(entry)).toBe(true);
      const record = entry as Record<string, unknown>;
      expect(record.hooks).toBeUndefined();
      expect(typeof record.command === "string" || typeof record.type === "string").toBe(true);
    }
  }
}

describe("G9 harness config schema", () => {
  it("keeps Claude wrappers, Cursor flat hooks, and empty-env hook commands after apply", async () => {
    const context = await createTestContext("g9-harness-config-schema");
    try {
      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      mkdirSync(join(context.homeDir, ".codex"), { recursive: true });
      mkdirSync(join(context.homeDir, ".config/opencode"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude/settings.json"),
        `${JSON.stringify({
          hooks: {
            SessionStart: [
              {
                hooks: [{ type: "command", command: "echo session-start" }],
              },
            ],
            Stop: [
              {
                hooks: [{ type: "command", command: "echo stop" }],
              },
            ],
          },
        }, null, 2)}\n`,
      );
      writeFileSync(
        join(context.homeDir, ".cursor/hooks.json"),
        `${JSON.stringify({
          version: 1,
          hooks: {
            sessionStart: [{ command: "echo cursor-start" }],
          },
        }, null, 2)}\n`,
      );
      writeFileSync(join(context.homeDir, ".codex/config.toml"), 'model = "gpt-5"\n');
      writeFileSync(
        join(context.homeDir, ".config/opencode/opencode.json"),
        `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: {} }, null, 2)}\n`,
      );

      const init = await runCli(["init", "--harnesses", "claude-code,cursor,codex,opencode"]);
      expect(init.exitCode ?? 0).toBe(0);
      setHarnessPreference({
        registered_harnesses: ["claude-code", "cursor", "codex", "opencode"],
      });
      await useProfileCommand("global default", { conflictPolicy: "replace", pull: false });

      const claudeSettings = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/settings.json"), "utf-8"),
      ) as { hooks?: unknown; enabledPlugins?: Record<string, boolean> };
      assertClaudeHooksWrapped(claudeSettings.hooks);
      expect(JSON.stringify(claudeSettings)).not.toContain("CLAUDE_PLUGIN_ROOT");
      expect(claudeSettings.enabledPlugins?.ponytail).toBeUndefined();

      if (existsSync(join(context.homeDir, ".cursor/hooks.json"))) {
        assertCursorHooksFlat(
          JSON.parse(readFileSync(join(context.homeDir, ".cursor/hooks.json"), "utf-8")),
        );
      }

      parseToml(readFileSync(join(context.homeDir, ".codex/config.toml"), "utf-8"));
      const opencode = JSON.parse(
        readFileSync(join(context.homeDir, ".config/opencode/opencode.json"), "utf-8"),
      ) as { $schema?: string };
      expect(opencode.$schema).toBe("https://opencode.ai/config.json");

      const commands = ["echo session-start", "echo stop", "echo cursor-start"];
      for (const command of commands) {
        expect(commandReferencesPluginRoot(command)).toBe(false);
        const result = spawnSync("sh", ["-c", command], {
          env: {},
          encoding: "utf-8",
        });
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain("TypeError");
      }
    } finally {
      await context.cleanup();
    }
  });

  it("registers a Claude host plugin as plugin@marketplace without standalone skills", async () => {
    const context = await createTestContext("g9-claude-host-plugin");
    try {
      const pinRoot = ".claude/plugins/cache/local/ponytail/5.1.0";
      mkdirSync(join(context.homeDir, pinRoot, ".claude-plugin"), { recursive: true });
      mkdirSync(join(context.homeDir, pinRoot, "skills", "ponytail"), { recursive: true });
      mkdirSync(join(context.homeDir, pinRoot, "skills", "ponytail-audit"), { recursive: true });
      writeFileSync(
        join(context.homeDir, pinRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({
          name: "ponytail",
          version: "5.1.0",
          description: "Session helpers",
        }),
      );
      writeFileSync(
        join(context.homeDir, pinRoot, "skills/ponytail/SKILL.md"),
        "---\nname: ponytail\n---\n# ponytail\n",
      );
      writeFileSync(
        join(context.homeDir, pinRoot, "skills/ponytail-audit/SKILL.md"),
        "---\nname: ponytail-audit\n---\n# audit\n",
      );

      const pin = makeResource({
        type: "plugin",
        name: "ponytail",
        namespace: "local",
        origin_kind: "marketplace_link",
        origin_ref: "ponytail@local",
        content: "{}",
        metadata: {
          source_kind: "local",
          marketplace_name: "local",
          resolved_version: "5.1.0",
        },
      });
      const skills = ["ponytail", "ponytail-audit"].map((name) =>
        makeResource({
          type: "skill",
          name,
          origin_kind: "marketplace_link",
          origin_ref: "https://github.com/DietrichGebert/ponytail.git",
          content: `# ${name}\n`,
          metadata: {
            imported_from: { plugin_name: "ponytail", relative_path: `skills/${name}/SKILL.md` },
          },
        }),
      );

      const results = await generateFiles(
        [pin, ...skills],
        ["claude-code"],
        context.homeDir,
        { target: "project", projectRoot: context.homeDir },
      );
      writeFiles(results[0]?.files ?? [], context.homeDir);

      const registry = JSON.parse(
        readFileSync(
          join(context.homeDir, ".claude/plugins/installed_plugins.json"),
          "utf-8",
        ),
      ) as {
        version: number;
        plugins: Record<string, Array<{ scope: string; installPath: string; version: string }>>;
      };
      expect(registry.version).toBe(2);
      expect(registry.plugins["ponytail@local"]?.[0]).toMatchObject({
        scope: "user",
        installPath: "cache/local/ponytail/5.1.0",
        version: "5.1.0",
      });

      const settings = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/settings.json"), "utf-8"),
      ) as { enabledPlugins?: Record<string, boolean> };
      expect(settings.enabledPlugins?.["ponytail@local"]).toBe(true);
      expect(settings.enabledPlugins?.ponytail).toBeUndefined();
      expect(JSON.stringify(settings)).not.toContain("CLAUDE_PLUGIN_ROOT");

      const skillsDir = join(context.homeDir, ".claude/skills");
      const standalone = existsSync(skillsDir)
        ? readdirSync(skillsDir).filter((name) => name.startsWith("ponytail"))
        : [];
      expect(standalone).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
