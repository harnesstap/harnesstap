import { describe, expect, it } from "bun:test";
import { affectedResourcesForManagedFileDiff } from "../../src/services/scoped-file-content-delta.ts";

describe("affectedResourcesForManagedFileDiff", () => {
  it("lists only MCP servers whose scoped fragment actually changed", () => {
    const expected = JSON.stringify({
      mcpServers: {
        devel: { url: "https://example.com/devel" },
        other: { url: "https://example.com/other" },
      },
    });
    const current = JSON.stringify({
      mcpServers: {
        devel: { url: "https://example.com/devel" },
        other: { url: "https://example.com/other-live" },
      },
    });

    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude.json",
        expected,
        current,
      }),
    ).toEqual([{ type: "mcp_server", name: "other" }]);
  });

  it("lists only permissions whose scoped fragment actually changed", () => {
    const expected = JSON.stringify({
      permissions: {
        allow: ["Bash(jk:*)", "Read"],
      },
    });
    const current = JSON.stringify({
      permissions: {
        allow: ["Bash(jk:*)", "Write"],
      },
    });

    expect(
      affectedResourcesForManagedFileDiff({
        path: ".claude/settings.json",
        expected,
        current,
      }),
    ).toEqual([
      { type: "permission", name: "allow-Read" },
      { type: "permission", name: "allow-Write" },
    ]);
  });
});
