import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("home scan reconcile", () => {
  it("drops OpenCode MCP servers removed from opencode.json on rescan", async () => {
    const context = await createInitializedTestContext("home-scan-opencode-mcp");
    try {
      const configDir = join(context.homeDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = join(configDir, "opencode.json");
      writeFileSync(
        configPath,
        `${JSON.stringify(
          {
            mcp: {
              github: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"] },
              slack: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-slack"] },
            },
          },
          null,
          2,
        )}\n`,
      );

      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["opencode"] });

      const { rescanResourceTrackedDirectories } = await import(
        "../../src/services/resource-tracked-directories.ts"
      );
      const { listResources } = await import("../../src/models/resource.ts");
      const { getHarnessInventory } = await import(
        "../../src/services/harness-inventory.ts"
      );

      await rescanResourceTrackedDirectories();

      const mcpNames = () =>
        listResources()
          .filter(
            (resource) =>
              resource.type === "mcp_server"
              && resource.source === "~/.config/opencode/opencode.json",
          )
          .map((resource) => resource.name)
          .sort();

      expect(mcpNames()).toEqual(["github", "slack"]);

      const inventoryWithBoth = getHarnessInventory(context.homeDir);
      const opencode = inventoryWithBoth.harnesses.find((entry) => entry.id === "opencode");
      const mcpRows =
        opencode?.locations.flatMap((location) =>
          location.resources.filter((resource) => resource.type === "mcp_server"),
        ) ?? [];
      expect(mcpRows.map((row) => row.name).sort()).toEqual(["github", "slack"]);

      writeFileSync(
        configPath,
        `${JSON.stringify(
          {
            mcp: {
              github: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"] },
            },
          },
          null,
          2,
        )}\n`,
      );

      await rescanResourceTrackedDirectories();

      expect(mcpNames()).toEqual(["github"]);

      const inventoryAfter = getHarnessInventory(context.homeDir);
      const opencodeAfter = inventoryAfter.harnesses.find((entry) => entry.id === "opencode");
      const mcpAfter =
        opencodeAfter?.locations.flatMap((location) =>
          location.resources.filter((resource) => resource.type === "mcp_server"),
        ) ?? [];
      expect(mcpAfter.map((row) => row.name)).toEqual(["github"]);
    } finally {
      await context.cleanup();
    }
  });

  it("drops live library refs for deleted OpenCode agents on rescan", async () => {
    const context = await createInitializedTestContext("home-scan-opencode-agent");
    try {
      const agentsDir = join(context.homeDir, ".config", "opencode", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(context.homeDir, ".config", "opencode", "opencode.json"),
        `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
      );
      const agentPath = join(agentsDir, "agent-creator.md");
      writeFileSync(agentPath, "# agent-creator\n", "utf-8");

      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({ registered_harnesses: ["opencode"] });

      const { createPlugin, setPluginTags } = await import(
        "../../src/models/plugin-model.ts"
      );
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);

      const { detectNotStagedProfileResources } = await import(
        "../../src/services/profile-untracked-resources.ts"
      );
      const { rescanResourceTrackedDirectories } = await import(
        "../../src/services/resource-tracked-directories.ts"
      );
      const { listResources } = await import("../../src/models/resource.ts");

      const before = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
      });
      expect(before.some((resource) => resource.name === "agent-creator")).toBe(
        true,
      );
      expect(
        listResources().some(
          (resource) =>
            resource.type === "agent" && resource.name === "agent-creator",
        ),
      ).toBe(true);

      rmSync(agentPath, { force: true });
      await rescanResourceTrackedDirectories();

      expect(
        listResources().some(
          (resource) =>
            resource.type === "agent" && resource.name === "agent-creator",
        ),
      ).toBe(false);
      const after = await detectNotStagedProfileResources({
        profileSelector: "work",
        scope: "home",
      });
      expect(after.some((resource) => resource.name === "agent-creator")).toBe(
        false,
      );
    } finally {
      await context.cleanup();
    }
  });
});
