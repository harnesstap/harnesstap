import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  materializeFiles,
  planMaterializationConflicts,
} from "../../src/services/applier.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const LIVE_MCP =
  '{ "mcpServers": { "cursor-mcp": { "command": "node", "args": ["server.js"] } } }\n';

function generatedMcp(command: string): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        "cursor-mcp": {
          type: "stdio",
          command,
          args: ["server.js"],
        },
      },
    },
    null,
    2,
  )}\n`;
}

describe("planMaterializationConflicts no-op", () => {
  it("does not treat a semantically equal mcp.json as a conflict", async () => {
    const context = await createInitializedTestContext("noop-conflict-equal");
    try {
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(join(context.homeDir, ".cursor/mcp.json"), LIVE_MCP);
      const generated = generatedMcp("node");

      const conflicts = await planMaterializationConflicts(
        [{ path: ".cursor/mcp.json", content: generated }],
        context.homeDir,
      );
      expect(conflicts).toEqual([]);

      const applied = await materializeFiles(
        [{ path: ".cursor/mcp.json", content: generated }],
        context.homeDir,
        { conflictPolicy: "cancel" },
      );
      expect(applied.cancelled).toBe(false);
      expect(applied.writtenFiles).toEqual([]);
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(LIVE_MCP);
    } finally {
      await context.cleanup();
    }
  });

  it("still cancels when the file would actually change", async () => {
    const context = await createInitializedTestContext("noop-conflict-real");
    try {
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(join(context.homeDir, ".cursor/mcp.json"), LIVE_MCP);
      const generated = generatedMcp("other");

      const applied = await materializeFiles(
        [{ path: ".cursor/mcp.json", content: generated }],
        context.homeDir,
        { conflictPolicy: "cancel" },
      );
      expect(applied.cancelled).toBe(true);
      expect(applied.writtenFiles).toEqual([]);
      expect(applied.conflicts.map((conflict) => conflict.path)).toEqual([
        ".cursor/mcp.json",
      ]);
      expect(readFileSync(join(context.homeDir, ".cursor/mcp.json"), "utf-8")).toBe(LIVE_MCP);
    } finally {
      await context.cleanup();
    }
  });

  it("still flags two planned writers of one path", async () => {
    const context = await createInitializedTestContext("noop-conflict-dup");
    try {
      const conflicts = await planMaterializationConflicts(
        [
          { path: ".cursor/mcp.json", content: "{}\n" },
          { path: ".cursor/mcp.json", content: "{}\n" },
        ],
        context.homeDir,
      );
      expect(conflicts.map((conflict) => conflict.path)).toEqual([".cursor/mcp.json"]);
    } finally {
      await context.cleanup();
    }
  });
});
