import { describe, expect, it } from "bun:test";
import { fileContentsEquivalentForDrift } from "../../src/services/file-contents-drift.ts";
import { jsonContentsEquivalent } from "../../src/utils/json-equal.ts";

describe("jsonContentsEquivalent", () => {
  it("treats whitespace and key-order differences as equal", () => {
    const compact = '{"b":2,"a":1}';
    const pretty = `{
  "a": 1,
  "b": 2
}
`;
    expect(jsonContentsEquivalent(compact, pretty)).toBe(true);
  });

  it("detects value differences", () => {
    expect(jsonContentsEquivalent('{"a":1}', '{"a":2}')).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(jsonContentsEquivalent("{", "{}")).toBe(false);
  });
});

describe("fileContentsEquivalentForDrift", () => {
  it("matches identical bytes", () => {
    expect(fileContentsEquivalentForDrift("notes.md", "hello", "hello")).toBe(true);
  });

  it("matches markdown that differs only by a trailing newline", () => {
    expect(
      fileContentsEquivalentForDrift(
        ".claude/rules/security.md",
        "# Security rules\nNever log secrets.\n",
        "# Security rules\nNever log secrets.",
      ),
    ).toBe(true);
    expect(
      fileContentsEquivalentForDrift(
        ".claude/rules/security.md",
        "# Security rules\nNever log secrets.\n",
        "# Security rules\nNever log secrets.\nUSER",
      ),
    ).toBe(false);
  });

  it("matches JSON files after parse when bytes differ", () => {
    expect(
      fileContentsEquivalentForDrift(
        ".cursor/hooks.json",
        '{"version":1}',
        '{\n  "version": 1\n}\n',
      ),
    ).toBe(true);
  });

  it("does not JSON-compare non-json paths", () => {
    expect(
      fileContentsEquivalentForDrift("AGENTS.md", '{"a":1}', '{\n  "a": 1\n}'),
    ).toBe(false);
  });

  it("matches MCP configs with harness-only field noise", () => {
    const live = `${JSON.stringify(
      { mcpServers: { alpha: { url: "https://example.com/mcp" } } },
      null,
      2,
    )}\n`;
    const serialized = JSON.stringify(
      {
        mcpServers: {
          alpha: { type: "http", url: "https://example.com/mcp", tools: ["*"] },
        },
      },
      null,
      2,
    );
    expect(
      fileContentsEquivalentForDrift(".copilot/mcp-config.json", live, serialized),
    ).toBe(true);
  });

  it("matches Cursor MCP configs that only add type stdio", () => {
    const live =
      '{ "mcpServers": { "cursor-mcp": { "command": "node", "args": ["server.js"] } } }\n';
    const generated = `${JSON.stringify(
      {
        mcpServers: {
          "cursor-mcp": {
            type: "stdio",
            command: "node",
            args: ["server.js"],
          },
        },
      },
      null,
      2,
    )}\n`;
    expect(fileContentsEquivalentForDrift(".cursor/mcp.json", live, generated)).toBe(true);
  });

  it("matches Codex config.toml after key reorder and formatting", () => {
    const live = 'model = "gpt-5"\n[mcp_servers.codex-mcp]\ncommand = "uvx"\n';
    const generated = `model = "gpt-5"

[mcp_servers.codex-mcp]
command = "uvx"
`;
    expect(
      fileContentsEquivalentForDrift(".codex/config.toml", live, generated),
    ).toBe(true);
  });
});
