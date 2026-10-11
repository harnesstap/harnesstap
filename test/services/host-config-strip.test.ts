import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { recordPreexistingPath } from "../../src/models/preexisting-path.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import type { Resource } from "../../src/types.ts";
import {
  rewriteStaleMergeableHostConfigs,
  tryEditAggregateContent,
} from "../../src/services/host-config-strip.ts";

function fakeResource(name: string, type: Resource["type"] = "mcp_server"): Resource {
  return {
    id: "test",
    type,
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

describe("host config strip", () => {
  it("removes owned JSON MCP servers and keeps unmanaged siblings", () => {
    const resource = fakeResource("devel");
    const live = `${JSON.stringify({
      mcpServers: {
        devel: { url: "https://example.com" },
        keep: { command: "node" },
      },
      $schema: "https://example.com/schema.json",
    }, null, 2)}\n`;
    const edit = tryEditAggregateContent(live, resource);
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    expect(edit.emptied).toBe(false);
    expect(edit.content).toContain("keep");
    expect(edit.content).toContain("$schema");
    expect(edit.content).not.toContain("devel");
  });

  it("removes owned TOML mcp_servers tables and keeps model", () => {
    const resource = fakeResource("codex-mcp");
    const live = `model = "gpt-5"\n\n[mcp_servers.codex-mcp]\ncommand = "uvx"\n`;
    const edit = tryEditAggregateContent(live, resource);
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    expect(edit.content).toContain("gpt-5");
    expect(edit.content).not.toContain("codex-mcp");
  });

  it("rewrites an owned mcp.json on disk and leaves unmanaged keys", async () => {
    const context = await createInitializedTestContext("host-config-strip-rewrite");
    try {
      const relative = ".cursor/mcp.json";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      const body = `${JSON.stringify({
        mcpServers: {
          devel: { url: "https://example.com" },
          keep: { command: "node" },
        },
      }, null, 2)}\n`;
      writeFileSync(full, body);
      const resource = createResource({
        type: "mcp_server",
        name: "devel",
        description: "",
        content: "",
        metadata: { transport: "http", url: "https://example.com" },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: relative,
        action: "edit-file",
        ownership_key: "mcp_server:devel",
        generated_hash: hashGeneratedContent(body),
      });
      const result = rewriteStaleMergeableHostConfigs(context.homeDir, [relative], {
        applyId: "test-apply",
      });
      expect(result.rewritten).toEqual([relative]);
      expect(existsSync(full)).toBe(true);
      const next = readFileSync(full, "utf-8");
      expect(next).toContain("keep");
      expect(next).not.toContain("devel");
    } finally {
      await context.cleanup();
    }
  });

  it("does not strip keys from a preexisting shared config", async () => {
    const context = await createInitializedTestContext("host-strip-preexisting");
    try {
      const relative = ".cursor/mcp.json";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      const body = `${JSON.stringify({
        mcpServers: { "cursor-mcp": { command: "node" } },
      }, null, 2)}\n`;
      writeFileSync(full, body);
      recordPreexistingPath({
        root_path: context.homeDir,
        path: relative,
        content_hash: hashGeneratedContent(body),
      });
      const resource = createResource({
        type: "mcp_server",
        name: "cursor-mcp",
        description: "",
        content: "",
        metadata: { command: "node" },
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: relative,
        action: "edit-file",
        ownership_key: "mcp_server:cursor-mcp",
        generated_hash: hashGeneratedContent(body),
      });
      const result = rewriteStaleMergeableHostConfigs(context.homeDir, [relative], {
        applyId: "test-apply",
      });
      expect(result.skipped).toContain(relative);
      expect(readFileSync(full, "utf-8")).toContain("cursor-mcp");
    } finally {
      await context.cleanup();
    }
  });

  it("removes only the registered plugin@marketplace key from enabledPlugins", () => {
    const resource: Resource = {
      ...fakeResource("ponytail", "plugin"),
      namespace: "local",
      origin_ref: "ponytail@local",
    };
    const live = `${JSON.stringify({
      enabledPlugins: {
        ponytail: true,
        "ponytail@local": true,
        "keep@elsewhere": true,
      },
    }, null, 2)}\n`;
    const edit = tryEditAggregateContent(live, resource);
    expect(edit.ok).toBe(true);
    if (!edit.ok) {
      return;
    }
    const parsed = JSON.parse(edit.content) as { enabledPlugins: Record<string, boolean> };
    expect(parsed.enabledPlugins["ponytail@local"]).toBeUndefined();
    expect(parsed.enabledPlugins.ponytail).toBe(true);
    expect(parsed.enabledPlugins["keep@elsewhere"]).toBe(true);
  });
});
