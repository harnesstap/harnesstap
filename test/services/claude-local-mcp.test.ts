import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  claudeLocalMcpSource,
  isClaudeLocalMcpResource,
  listClaudeLocalMcpServers,
  localMcpCreateInputsFromDocument,
} from "../../src/services/claude-local-mcp.ts";

describe("claude local-scope MCP", () => {
  const document = {
    mcpServers: { docs: { command: "user-mcp" } },
    projects: {
      "/tmp/app": {
        mcpServers: { localOnly: { command: "npx", args: ["local-mcp"] } },
      },
      "/tmp/other": {
        allowedTools: [],
      },
    },
  };

  it("lists local-scope servers without mixing in user-scope", () => {
    const listed = listClaudeLocalMcpServers(document);
    expect(listed).toEqual([
      {
        projectPath: "/tmp/app",
        name: "localOnly",
        metadata: expect.objectContaining({
          command: "npx",
          claude_mcp_scope: "local",
          claude_project_path: resolve("/tmp/app"),
        }),
      },
    ]);
  });

  it("filters to one project path", () => {
    expect(listClaudeLocalMcpServers(document, "/tmp/app")).toHaveLength(1);
    expect(listClaudeLocalMcpServers(document, "/tmp/missing")).toEqual([]);
  });

  it("uses a dedicated source and does not collide with user-scope names", () => {
    const resources = localMcpCreateInputsFromDocument(
      document,
      undefined,
      new Set(["docs", "localOnly"]),
    );
    expect(resources).toHaveLength(1);
    expect(resources[0]?.name).toBe("localOnly@local");
    expect(resources[0]?.source).toBe(claudeLocalMcpSource("/tmp/app"));
    expect(isClaudeLocalMcpResource(resources[0] ?? {})).toBe(true);
  });
});
