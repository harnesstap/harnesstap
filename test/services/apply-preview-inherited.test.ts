import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import {
  listHostNativeMcpNames,
  hostPluginPinIsInstalled,
} from "../../src/services/host-native-mcp.ts";
import { buildHarnessLiveStatusMap } from "../../src/services/global-profile-status-panel.ts";
import { omitInheritedPluginFileChanges } from "../../src/services/apply-preview-inherited.ts";
import { createResource } from "../../src/models/resource.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";

describe("host-native MCP", () => {
  it("detects Cursor plugin-slack-slack as native slack MCP", async () => {
    const context = await createInitializedTestContext("host-native-mcp-slack");
    try {
      mkdirSync(join(context.homeDir, ".cursor", "projects", "mcps", "plugin-slack-slack"), {
        recursive: true,
      });

      expect([...listHostNativeMcpNames(context.homeDir, "cursor")]).toContain("slack");

      const harnesses = buildHarnessLiveStatusMap({
        depth: "full",
        homeRoot: context.homeDir,
        declaredPins: [],
        declaredMcpByHarness: { cursor: ["slack"] },
      });
      expect(harnesses.cursor?.mcp).toEqual([
        { name: "slack", state: "present" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("reads MCP names from Cursor plugin mcp.json", async () => {
    const context = await createInitializedTestContext("host-native-mcp-plugin-json");
    try {
      const installPath = join(
        context.homeDir,
        ".cursor",
        "plugins",
        "cache",
        "cursor-public",
        "slack",
        "1.0.0",
      );
      mkdirSync(join(installPath, ".cursor-plugin"), { recursive: true });
      writeTextFile(
        join(installPath, ".cursor-plugin", "plugin.json"),
        JSON.stringify({ name: "slack", version: "1.0.0" }),
      );
      writeTextFile(
        join(installPath, "mcp.json"),
        JSON.stringify({ mcpServers: { slack: { command: "slack-mcp" } } }),
      );

      expect([...listHostNativeMcpNames(context.homeDir, "cursor")]).toContain("slack");
    } finally {
      await context.cleanup();
    }
  });
});

describe("inherited plugin apply-preview file changes", () => {
  it("omits missing harness copies of installed host-plugin skills", async () => {
    const context = await createInitializedTestContext("inherited-plugin-preview-files");
    try {
      createResource({
        type: "skill",
        name: "brainstorming",
        description: "",
        content: "# brainstorming\n",
        metadata: {},
        source: "marketplace",
        origin_kind: "marketplace_link",
        origin_ref: "pack@market",
      });
      mkdirSync(join(context.homeDir, ".claude", "plugins"), { recursive: true });
      writeTextFile(
        join(context.homeDir, ".claude", "plugins", "installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "pack@market": [
              {
                scope: "user",
                installPath: "CACHE/pack",
                version: "1.0.0",
              },
            ],
          },
        }),
      );

      expect(hostPluginPinIsInstalled(context.homeDir, "pack@market")).toBe(true);

      const changes = omitInheritedPluginFileChanges(
        context.homeDir,
        [
          {
            path: ".claude/skills/brainstorming/SKILL.md",
            type: "deleted",
            resource: { type: "skill", name: "brainstorming" },
          },
          {
            path: ".claude/CLAUDE.md",
            type: "deleted",
            resource: { type: "instruction", name: "guide" },
          },
        ],
        new Set(["pack@market"]),
      );

      expect(changes.map((change) => change.path)).toEqual([".claude/CLAUDE.md"]);
    } finally {
      await context.cleanup();
    }
  });

  it("does not flag Cursor-native slack MCP as missing in apply preview", async () => {
    const context = await createInitializedTestContext("preview-native-slack-mcp");
    try {
      mkdirSync(join(context.homeDir, ".cursor", "projects", "mcps", "plugin-slack-slack"), {
        recursive: true,
      });
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const mcp = createResource({
        type: "mcp_server",
        name: "slack",
        description: "",
        content: JSON.stringify({ command: "unused-ht-slack" }),
        metadata: { transport: "stdio", command: "unused-ht-slack" },
        source: "manual",
      });
      addResourceToPlugin(plugin.id, mcp.id);

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "cursor",
      });

      expect(preview.harnesses?.cursor?.mcp).toEqual([
        { name: "slack", state: "present" },
      ]);
      expect(
        preview.files.changes.some((change) => change.path.includes("mcp.json")),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
