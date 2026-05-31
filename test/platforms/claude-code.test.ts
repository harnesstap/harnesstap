import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { ClaudeCodeSerializer } from "../../src/platforms/claude-code.ts";
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
});
