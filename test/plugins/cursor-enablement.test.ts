import { describe, it, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  collectCursorEnablementSignals,
  cursorLoadsForeignHarnessTrees,
  pluginNameFromStoredId,
  pluginNamesFromInstalledPluginFile,
  pluginNamesFromMcpFolders,
  pluginNamesFromSkillPaths,
} from "../../src/plugins/cursor-enablement.js";
import { createTempDir, cleanupDir } from "../helpers/fs.ts";

describe("cursor-enablement helpers", () => {
  it("parses duplicated plugin MCP folder names", () => {
    const names = pluginNamesFromMcpFolders([
      "plugin-active-plugin-active-plugin",
      "plugin-slack-slack",
      "plugin-context7-plugin-context7",
      "user-bigquery-mcp",
    ]);
    expect([...names].sort()).toEqual([
      "active-plugin",
      "context7-plugin-context7",
      "slack",
    ]);
  });

  it("extracts plugin names from recently-used skill paths", () => {
    const names = pluginNamesFromSkillPaths([
      "cache/cursor-public/superpowers/d884ae04/skills/brainstorming/SKILL.md",
      "cache/teads-plugins/devx/97eded/skills/metoda/SKILL.md",
      "ui-ux-pro-max/SKILL.md",
    ]);
    expect([...names].sort()).toEqual(["devx", "superpowers"]);
  });

  it("parses stored plugin ids and installed.json records", () => {
    expect(pluginNameFromStoredId("677")).toBeNull();
    expect(pluginNameFromStoredId("slack@cursor-public")).toBe("slack");
    expect(pluginNameFromStoredId("anysphere.cursor-plugins.gmail")).toBe("gmail");
    expect(
      [...pluginNamesFromInstalledPluginFile({
        plugins: {
          "superpowers@cursor-public": [{ scope: "user", installPath: "cache/x" }],
        },
      })].sort(),
    ).toEqual(["superpowers"]);
  });

  it("treats Cursor settings false as disabling foreign harness trees", () => {
    const home = createTempDir("cursor-third-party-off");
    try {
      const settingsPath = join(home, ".config", "Cursor", "User", "settings.json");
      mkdirSync(join(settingsPath, ".."), { recursive: true });
      writeFileSync(
        settingsPath,
        JSON.stringify({ "cursor.skills.includeThirdPartyPlugins": false }),
      );
      expect(cursorLoadsForeignHarnessTrees(home)).toBe(false);
    } finally {
      cleanupDir(home);
    }
  });

  it("reads installed plugin names from state.vscdb and installed.json", () => {
    const home = createTempDir("cursor-installed-records");
    try {
      mkdirSync(join(home, ".cursor", "plugins"), { recursive: true });
      writeFileSync(
        join(home, ".cursor", "plugins", "installed.json"),
        JSON.stringify({ plugins: ["pstack@cursor-public"] }),
      );
      const dbDir = join(home, ".config", "Cursor", "User", "globalStorage");
      mkdirSync(dbDir, { recursive: true });
      const db = new Database(join(dbDir, "state.vscdb"));
      db.run("CREATE TABLE ItemTable (key TEXT, value BLOB)");
      db.run(
        "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
        [
          "cursor.plugins.installedIds.no-team",
          JSON.stringify(["slack", "github"]),
        ],
      );
      db.close();

      const signals = collectCursorEnablementSignals(home);
      expect([...signals.pluginNames].sort()).toEqual([
        "github",
        "pstack",
        "slack",
      ]);
    } finally {
      cleanupDir(home);
    }
  });
});
