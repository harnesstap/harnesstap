import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { ClaudeCodeSerializer } from "../../src/platforms/claude-code.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CLAUDE_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/claude-project", import.meta.url),
);

describe("ClaudeCodeSerializer", () => {
  it("scans Claude Code resources from disk", async () => {
    const serializer = new ClaudeCodeSerializer();
    const resources = await serializer.scan(CLAUDE_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining([
        "instruction",
        "rule",
        "skill",
        "mcp_server",
        "permission",
        "env_var",
        "agent",
        "command",
      ]),
    );
    expect(resources.find((resource) => resource.type === "rule")?.metadata).toEqual({
      globs: ["src/api/**"],
      always_apply: false,
    });
    expect(resources.find((resource) => resource.type === "mcp_server")?.metadata).toEqual(
      expect.objectContaining({
        transport: "http",
        url: "https://example.com/mcp",
      }),
    );
  });

  it("serializes Claude Code resources to the expected files", async () => {
    const serializer = new ClaudeCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "claude", content: "# Root" }),
        makeResource({
          type: "rule",
          name: "api",
          content: "Use Zod",
          metadata: { globs: ["src/api/**"], always_apply: false },
        }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "mcp_server",
          name: "docs",
          metadata: { transport: "http", url: "https://example.com/mcp" },
        }),
        makeResource({
          type: "permission",
          name: "allow-read",
          metadata: { action: "allow", pattern: "Read(*)" },
        }),
        makeResource({
          type: "env_var",
          name: "API_KEY",
          metadata: { key: "API_KEY", value: "demo" },
        }),
        makeResource({ type: "agent", name: "helper", content: "# Helper" }),
        makeResource({ type: "command", name: "review", content: "# Review" }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "CLAUDE.md",
        ".claude/rules/api.md",
        ".claude/skills/research/SKILL.md",
        ".mcp.json",
        ".claude/settings.json",
        ".claude/agents/helper.md",
        ".claude/commands/review.md",
      ]),
    );
    expect(files.find((file) => file.path === ".claude/rules/api.md")?.content).toContain(
      "paths:",
    );
    expect(
      JSON.parse(files.find((file) => file.path === ".mcp.json")?.content ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        mcpServers: {
          docs: {
            type: "http",
            url: "https://example.com/mcp",
          },
        },
      }),
    );
  });

  it("serializes claude agent metadata as frontmatter", async () => {
    const serializer = new ClaudeCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "agent",
          name: "release-reviewer",
          description: "Release review specialist",
          content: "# Release Reviewer",
          metadata: {
            model: "claude-sonnet-4-5",
            reasoning_effort: "high",
            sandbox_mode: "workspace-write",
          },
        }),
      ],
      ".",
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: ".claude/agents/release-reviewer.md" });
    expect(files[0]?.content).toContain("model: claude-sonnet-4-5");
    expect(files[0]?.content).toContain("reasoning_effort: high");
    expect(files[0]?.content).toContain("sandbox_mode: workspace-write");
    expect(files[0]?.content).toContain("# Release Reviewer");
  });

  it("serializes global Claude Code resources into global paths", async () => {
    const serializer = new ClaudeCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "claude", content: "# Root" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "agent",
          name: "helper",
          description: "Helper",
          content: "# Helper",
        }),
      ],
      ".",
      { target: "global" },
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        ".claude/CLAUDE.md",
        ".claude/skills/research/SKILL.md",
        ".claude/agents/helper.md",
      ]),
    );
    expect(files.find((file) => file.path === "CLAUDE.md")).toBeUndefined();
  });

  it("omits unsupported ask permissions from Claude settings output", async () => {
    const serializer = new ClaudeCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "permission",
          name: "ask-read",
          metadata: { action: "ask", pattern: "Read(*)" },
        }),
      ],
      ".",
    );

    expect(files).toEqual([]);
  });

  it("scans hooks from home ~/.claude/settings.json", async () => {
    const home = createTempDir("claude-home-hooks-");
    try {
      writeTextFile(
        join(home, ".claude", "settings.json"),
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "echo hi" }],
                },
              ],
            },
          },
          null,
          2,
        ),
      );

      const serializer = new ClaudeCodeSerializer();
      const resources = await serializer.scanGlobal(home);

      expect(resources.some((resource) => resource.type === "hook")).toBe(true);
    } finally {
      cleanupDir(home);
    }
  });

  it("round-trips HTTP MCP headers on scan and serialize", async () => {
    const projectDir = createTempDir("claude-mcp-headers");

    try {
      writeTextFile(
        join(projectDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            api: {
              type: "http",
              url: "https://mcp.example.com",
              headers: { Authorization: "Bearer ${API_TOKEN}" },
            },
          },
        }),
      );

      const serializer = new ClaudeCodeSerializer();
      const scanned = await serializer.scan(projectDir);
      const mcp = scanned.find((resource) => resource.type === "mcp_server");
      expect(mcp?.metadata).toEqual(
        expect.objectContaining({
          transport: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer ${API_TOKEN}" },
        }),
      );

      const files = await serializer.serialize(
        [
          makeResource({
            type: "mcp_server",
            name: "api",
            metadata: mcp?.metadata ?? {},
          }),
        ],
        ".",
      );

      const config = JSON.parse(
        files.find((file) => file.path === ".mcp.json")?.content ?? "{}",
      );
      expect(config.mcpServers.api).toEqual({
        type: "http",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
      });
    } finally {
      cleanupDir(projectDir);
    }
  });
});
