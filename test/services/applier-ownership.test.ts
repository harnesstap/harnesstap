import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";
import { createResource } from "../../src/models/resource.ts";
import { listResourceMaterializations } from "../../src/models/resource-materialization.ts";

describe("applier ownership", () => {
  it("annotates standalone skills and aggregate MCP files with ownership metadata", async () => {
    const context = await createInitializedTestContext("applier-ownership-annotate");

    try {
      const applier = await import("../../src/services/applier.ts");
      const skill = makeResource({
        id: "skill-ship",
        type: "skill",
        name: "ship",
        description: "Ship skill",
        content: "# Ship",
      });
      const mcp = makeResource({
        id: "mcp-search",
        type: "mcp_server",
        name: "search",
        description: "Search MCP",
        content: "",
        metadata: {
          transport: "stdio",
          command: "search-mcp",
        },
      });

      const results = await applier.generateFiles(
        [skill, mcp],
        ["cursor"],
        context.projectDir,
        { skillCursorMode: "agents-skills" },
      );

      const skillFile = results[0]?.files.find((file) =>
        file.path.endsWith("/ship/SKILL.md"),
      );
      const mcpFile = results[0]?.files.find((file) => file.path.endsWith("mcp.json"));

      expect(skillFile?.ownership).toEqual([
        {
          resource_id: skill.id,
          action: "delete-directory",
          ownership_key: "skill:ship",
          managed_container: true,
        },
      ]);
      expect(mcpFile?.ownership?.[0]?.ownership_key).toBe("mcp_server:search");
      expect(mcpFile?.ownership?.[0]?.action).toBe("delete-file");
    } finally {
      await context.cleanup();
    }
  });

  it("records ownership rows after a successful global apply", async () => {
    const context = await createInitializedTestContext("applier-ownership-global");

    try {
      const resource = createResource({
        type: "skill",
        name: "global-ship",
        description: "Global ship skill",
        content: "# Global Ship",
        metadata: {},
        source: "manual",
      });
      const applier = await import("../../src/services/applier.ts");

      const applied = await applier.applyToGlobal(
        [resource],
        ["cursor"],
        context.homeDir,
        {
          conflictPolicy: "replace",
          skillCursorMode: "agents-skills",
        },
      );

      expect(applied.cancelled).toBe(false);
      const rows = listResourceMaterializations(resource.id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.scope).toBe("global");
      expect(rows[0]?.ownership_key).toBe("skill:global-ship");
    } finally {
      await context.cleanup();
    }
  });
});
