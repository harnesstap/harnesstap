import { describe, expect, it } from "bun:test";
import { filterMcpServersForTargetPath } from "../../src/services/mcp-target.ts";
import type { Resource } from "../../src/types.ts";
import { claudeLocalMcpSource } from "../../src/services/claude-local-mcp.ts";
import type { HarnessScope } from "../../src/services/harness-scope.ts";

function mcp(
  name: string,
  source: string,
  harnessScope?: HarnessScope,
): Resource {
  return {
    id: name,
    type: "mcp_server",
    name,
    description: "",
    content: "",
    metadata: { transport: "http", url: `https://example.com/${name}` },
    source,
    namespace: "",
    origin_kind: "local_snapshot",
    origin_ref: "",
    content_hash: "",
    content_blob_ref: "",
    created_at: "",
    updated_at: "",
    ...(harnessScope ? { harness_scope: harnessScope } : {}),
  };
}

describe("filterMcpServersForTargetPath", () => {
  const resources = [
    mcp("cursor-only", "~/.cursor/mcp.json"),
    mcp("copilot-only", "~/.copilot/mcp-config.json"),
    mcp("claude-user", "~/.claude.json"),
    mcp("claude-project", ".mcp.json"),
    mcp("portable", "manual"),
    mcp("from-manifest", "apm.yml"),
    mcp("claude-local", claudeLocalMcpSource("/tmp/app")),
  ];

  it("keeps path-matched and portable servers for copilot", () => {
    expect(
      filterMcpServersForTargetPath(resources, ".copilot/mcp-config.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["copilot-only", "portable", "from-manifest"]);
  });

  it("keeps path-matched and portable servers for cursor", () => {
    expect(
      filterMcpServersForTargetPath(resources, ".cursor/mcp.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["cursor-only", "portable", "from-manifest"]);
  });

  it("does not dual-write Claude user and project MCP files", () => {
    expect(
      filterMcpServersForTargetPath(resources, "~/.claude.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude-user", "portable", "from-manifest"]);
    expect(
      filterMcpServersForTargetPath(resources, ".mcp.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude-project", "portable", "from-manifest"]);
  });

  it("returns all servers when target path is missing", () => {
    expect(filterMcpServersForTargetPath(resources, undefined)).toHaveLength(6);
  });

  it("never emits Claude local-scope MCP onto any target", () => {
    expect(
      filterMcpServersForTargetPath(resources, "~/.claude.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude-user", "portable", "from-manifest"]);
    expect(
      filterMcpServersForTargetPath(resources, ".mcp.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude-project", "portable", "from-manifest"]);
    expect(
      filterMcpServersForTargetPath(resources, undefined).map((entry) => entry.name),
    ).not.toContain("claude-local");
  });

  it("fans a subset-scoped portable MCP only onto listed harnesses", () => {
    const scoped = [
      mcp("filesystem", "~/.claude.json", {
        kind: "subset",
        harnesses: ["claude-code", "cursor"],
      }),
    ];
    expect(
      filterMcpServersForTargetPath(scoped, ".cursor/mcp.json", "", "cursor").map(
        (entry) => entry.name,
      ),
    ).toEqual(["filesystem"]);
    expect(
      filterMcpServersForTargetPath(scoped, ".copilot/mcp-config.json", "", "copilot-cli").map(
        (entry) => entry.name,
      ),
    ).toEqual([]);
  });

  it("emits an MCP server from a Claude plugin package to the user config", () => {
    const fromPackage: Resource = {
      ...mcp("context7", ".mcp.json"),
      metadata: {
        transport: "http",
        url: "https://mcp.context7.com/mcp",
        imported_from: {
          source_kind: "claude-plugin",
          source_label: "context7",
          plugin_name: "context7",
          source_plugin_kind: "claude-plugin",
          relative_path: ".mcp.json",
          imported_at: "2026-10-18T00:00:00.000Z",
        },
      },
    };
    expect(
      filterMcpServersForTargetPath([...resources, fromPackage], "~/.claude.json").map(
        (entry) => entry.name,
      ),
    ).toEqual(["claude-user", "portable", "from-manifest", "context7"]);
    expect(
      filterMcpServersForTargetPath([fromPackage], ".cursor/mcp.json", "", "cursor").map(
        (entry) => entry.name,
      ),
    ).toEqual(["context7"]);
  });
});
