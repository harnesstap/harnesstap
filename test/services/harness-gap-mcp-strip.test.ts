import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import {
  rewriteStaleMergeableHostConfigs,
  tryEditAggregateContent,
} from "../../src/services/host-config-strip.ts";
import { isMergeableHostConfigPath } from "../../src/services/merged-host-config.ts";
import type { Resource } from "../../src/types.ts";

function mcpResource(name: string): Resource {
  return {
    id: "test",
    type: "mcp_server",
    name,
    description: "",
    content: "",
    metadata: {},
    source: "manual",
    namespace: "",
    origin_kind: "manual",
    origin_ref: "",
    content_hash: "",
    created_at: "",
    updated_at: "",
  };
}

describe("shared MCP config strip for new harness targets", () => {
  it("treats the new MCP files as mergeable shared configs", () => {
    for (const path of [
      ".gemini/settings.json",
      ".zed/settings.json",
      ".kiro/settings/mcp.json",
      ".factory/mcp.json",
    ]) {
      expect(isMergeableHostConfigPath(path)).toBe(true);
    }
  });

  it("removes only the owned Zed context server from a JSONC settings file", () => {
    const live = [
      "// Zed settings",
      "{",
      '  "theme": "One Dark",',
      '  "context_servers": {',
      '    "owned": { "command": "node", "args": ["a.js"] },',
      '    "mine": { "url": "https://example.com/mcp" },',
      "  },",
      "}",
      "",
    ].join("\n");
    const edit = tryEditAggregateContent(live, mcpResource("owned"));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.content).not.toContain("owned");
    expect(edit.content).toContain('"mine"');
    expect(edit.content).toContain('"theme": "One Dark"');
    expect(edit.content).toContain("// Zed settings");
  });

  it("drops the context_servers key when the last owned server goes", () => {
    const live = `${JSON.stringify({ theme: "x", context_servers: { owned: { command: "n" } } }, null, 2)}\n`;
    const edit = tryEditAggregateContent(live, mcpResource("owned"));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(JSON.parse(edit.content)).toEqual({ theme: "x" });
  });

  it("rewrites a Droid .factory/mcp.json keeping user servers and backs it up", async () => {
    const context = await createInitializedTestContext("harness-gap-droid-strip");
    try {
      const relative = ".factory/mcp.json";
      const full = join(context.projectDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      const body = `${JSON.stringify({
        mcpServers: {
          owned: { type: "stdio", command: "node" },
          user: { type: "http", url: "https://example.com/mcp" },
        },
      }, null, 2)}\n`;
      writeFileSync(full, body);
      const resource = createResource({
        type: "mcp_server",
        name: "owned",
        description: "",
        content: "",
        metadata: { command: "node" },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "project",
        root_path: context.projectDir,
        platform_id: "droid",
        path: relative,
        action: "edit-file",
        ownership_key: "mcp_server:owned",
        generated_hash: hashGeneratedContent(body),
      });
      const result = rewriteStaleMergeableHostConfigs(context.projectDir, [relative], {
        applyId: "test-apply",
      });
      expect(result.rewritten).toEqual([relative]);
      expect(existsSync(full)).toBe(true);
      const next = JSON.parse(readFileSync(full, "utf-8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(next.mcpServers)).toEqual(["user"]);
    } finally {
      await context.cleanup();
    }
  });
});
