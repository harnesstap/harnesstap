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
});
