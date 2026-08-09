import { describe, it, expect } from "bun:test";
import {
  pluginNamesFromMcpFolders,
  pluginNamesFromSkillPaths,
} from "../../src/plugins/cursor-enablement.js";

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
});
