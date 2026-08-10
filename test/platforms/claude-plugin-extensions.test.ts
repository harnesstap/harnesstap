import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTempDir } from "../helpers/fs.ts";
import { applyClaudePluginExtensions } from "../../src/platforms/claude-plugin-extensions.ts";

describe("applyClaudePluginExtensions", () => {
  it("merges marketplaces and plugins into settings.json", () => {
    const projectDir = createTempDir("claude-plugin-ext");

    const files = applyClaudePluginExtensions(
      [],
      {
        marketplaces: {
          "team-plugins": {
            source: { source: "github", repo: "org/claude-plugins" },
            autoUpdate: true,
          },
        },
        plugins: [
          { id: "formatter@team-plugins", enabled: true, version: "1.2.0" },
          { id: "linter@team-plugins", enabled: false },
        ],
      },
      projectDir,
    );

    const settingsFile = files.find((file) => file.path === ".claude/settings.json");
    expect(settingsFile).toBeDefined();
    if (!settingsFile) throw new Error("Expected settings.json");

    const settings = JSON.parse(settingsFile.content) as {
      extraKnownMarketplaces: Record<string, unknown>;
      enabledPlugins: Record<string, boolean>;
    };

    expect(settings.extraKnownMarketplaces["team-plugins"]).toEqual({
      source: { source: "github", repo: "org/claude-plugins" },
      autoUpdate: true,
    });
    expect(settings.enabledPlugins).toEqual({
      "formatter@team-plugins": true,
      "linter@team-plugins": false,
    });
  });

  it("preserves existing settings read from disk", () => {
    const projectDir = createTempDir("claude-plugin-ext-merge");
    const settingsPath = join(projectDir, ".claude", "settings.json");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { defaultMode: "auto" } }, null, 2),
      "utf-8",
    );

    const files = applyClaudePluginExtensions(
      [],
      {
        plugins: [{ id: "demo@marketplace", enabled: true }],
      },
      projectDir,
    );

    const written = JSON.parse(
      files.find((file) => file.path === ".claude/settings.json")?.content ?? "{}",
    ) as {
      permissions: { defaultMode: string };
      enabledPlugins: Record<string, boolean>;
    };

    expect(written.permissions.defaultMode).toBe("auto");
    expect(written.enabledPlugins["demo@marketplace"]).toBe(true);
  });

  it("merges with generated settings from resources", () => {
    const projectDir = createTempDir("claude-plugin-ext-resource");

    const files = applyClaudePluginExtensions(
      [
        {
          path: ".claude/settings.json",
          content: JSON.stringify({
            permissions: { allow: ["Bash(npm run *)"] },
          }),
        },
      ],
      {
        plugins: [{ id: "tooling@plugins", enabled: true }],
      },
      projectDir,
    );

    const settings = JSON.parse(
      files.find((file) => file.path === ".claude/settings.json")?.content ?? "{}",
    ) as {
      permissions: { allow: string[] };
      enabledPlugins: Record<string, boolean>;
    };

    expect(settings.permissions.allow).toEqual(["Bash(npm run *)"]);
    expect(settings.enabledPlugins["tooling@plugins"]).toBe(true);
  });
});
