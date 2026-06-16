import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { parse } from "smol-toml";
import { CodexSerializer } from "../../src/platforms/codex.ts";
import type { AgentMetadata } from "../../src/types.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CODEX_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/codex-project", import.meta.url),
);
const CODEX_CONFIG_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/platforms/codex-config", import.meta.url),
);

const API_DESIGNER_TOML = `name = "api-designer"
description = "Use when a task needs API contract design."
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Design APIs as long-lived contracts.
"""
`;

describe("CodexSerializer", () => {
  it("scans instructions, skills, and agents", async () => {
    const serializer = new CodexSerializer();
    const resources = await serializer.scan(CODEX_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["instruction", "skill", "agent"]),
    );
    expect(resources.find((resource) => resource.type === "agent")?.name).toBe("reviewer");
  });

  it("serializes instructions, rules, skills, and agents", async () => {
    const serializer = new CodexSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "codex", content: "# Codex" }),
        makeResource({ type: "rule", name: "api", content: "Use Zod" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "agent",
          name: "reviewer",
          content: 'name = "reviewer"\n',
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".agents/skills/research/SKILL.md",
        ".codex/agents/reviewer.toml",
      ]),
    );
    expect(files.find((file) => file.path === "AGENTS.md")?.content).toContain("## api");
  });

  it("scans Codex agent TOML into structured resources", async () => {
    const projectDir = createTempDir("codex-agent-structured");

    try {
      writeTextFile(join(projectDir, ".codex", "agents", "api-designer.toml"), API_DESIGNER_TOML);
      const resources = await new CodexSerializer().scan(projectDir);
      const agent = resources.find((resource) => resource.name === "api-designer");

      expect(agent?.description).toContain("API contract design");
      expect(agent?.content).toContain("long-lived contracts");
      expect((agent?.metadata as AgentMetadata).reasoning_effort).toBe("high");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("serializes canonical agent resources as valid Codex TOML", async () => {
    const files = await new CodexSerializer().serialize(
      [
        makeResource({
          type: "agent",
          name: "api-designer",
          description: "API specialist",
          content: "Design contracts.",
          metadata: {
            model: "gpt-5.4",
            reasoning_effort: "high",
            sandbox_mode: "read-only",
          },
        }),
      ],
      ".",
    );

    const file = files.find((entry) => entry.path.endsWith("api-designer.toml"));
    expect(file?.content).toContain("developer_instructions");
    expect(file?.content).toContain("model_reasoning_effort");
  });

  it("serializes global Codex resources into global paths", async () => {
    const serializer = new CodexSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "codex", content: "# Codex" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "agent",
          name: "reviewer",
          content: 'name = "reviewer"\n',
        }),
      ],
      ".",
      { target: "global" },
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        ".codex/AGENTS.md",
        ".agents/skills/research/SKILL.md",
        ".codex/agents/reviewer.toml",
      ]),
    );
    expect(files.find((file) => file.path === "AGENTS.md")).toBeUndefined();
  });

  it("skips malformed skill frontmatter instead of aborting the scan", async () => {
    const projectDir = createTempDir("codex-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Codex instructions");
      writeTextFile(
        join(projectDir, ".agents", "skills", "broken", "SKILL.md"),
        "---\nname: broken\ndescription: [\n---\nBroken skill\n",
      );
      writeTextFile(join(projectDir, ".codex", "agents", "reviewer.toml"), 'name = "reviewer"\n');

      const serializer = new CodexSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "agent", name: "reviewer" }),
        ]),
      );
      expect(resources.find((resource) => resource.type === "skill")).toBeUndefined();
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("scans MCP servers, permissions, env vars, and model config from config.toml", async () => {
    const serializer = new CodexSerializer();
    const resources = await serializer.scan(CODEX_CONFIG_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining([
        "mcp_server",
        "permission",
        "env_var",
        "model_config",
      ]),
    );

    const filesystem = resources.find(
      (resource) => resource.type === "mcp_server" && resource.name === "filesystem",
    );
    expect(filesystem?.metadata).toEqual(
      expect.objectContaining({
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { DIR: "/tmp" },
      }),
    );

    const remote = resources.find(
      (resource) => resource.type === "mcp_server" && resource.name === "remote",
    );
    expect(remote?.metadata).toEqual(
      expect.objectContaining({
        transport: "http",
        url: "https://mcp.example.com/mcp",
      }),
    );

    const permission = resources.find((resource) => resource.type === "permission");
    expect(permission?.metadata).toEqual({
      action: "deny",
      pattern: "filesystem:project:deny:**/*.env",
    });

    const envVar = resources.find((resource) => resource.type === "env_var");
    expect(envVar?.metadata).toEqual({ key: "API_KEY", value: "from-config" });

    const modelConfig = resources.find((resource) => resource.type === "model_config");
    expect(modelConfig?.metadata).toEqual({
      model: "gpt-5",
      provider: "openai",
    });
  });

  it("serializes config.toml resources and preserves unrelated keys", async () => {
    const projectDir = createTempDir("codex-config-serialize");

    try {
      writeTextFile(
        join(projectDir, ".codex", "config.toml"),
        'personality = "pragmatic"\nlegacy_flag = true\n',
      );

      const serializer = new CodexSerializer();
      const files = await serializer.serialize(
        [
          makeResource({
            type: "mcp_server",
            name: "filesystem",
            metadata: {
              transport: "stdio",
              command: "npx",
              args: ["-y", "server"],
            },
          }),
          makeResource({
            type: "permission",
            name: "deny-project-env",
            metadata: {
              action: "deny",
              pattern: "filesystem:project:deny:**/*.env",
            },
          }),
          makeResource({
            type: "env_var",
            name: "API_KEY",
            metadata: { key: "API_KEY", value: "from-config" },
          }),
          makeResource({
            type: "model_config",
            name: "default",
            metadata: { model: "gpt-5", provider: "openai" },
          }),
        ],
        projectDir,
      );

      const config = files.find((file) => file.path === ".codex/config.toml");
      expect(config).toBeDefined();
      if (!config) throw new Error("Expected Codex config file");

      const parsed = parse(config.content) as Record<string, unknown>;
      expect(parsed.personality).toBe("pragmatic");
      expect(parsed.legacy_flag).toBe(true);
      expect(parsed.model).toBe("gpt-5");
      expect(parsed.model_provider).toBe("openai");
      expect(parsed.mcp_servers).toEqual({
        filesystem: {
          command: "npx",
          args: ["-y", "server"],
        },
      });
      expect(parsed.permissions).toEqual({
        project: {
          filesystem: {
            "**/*.env": "deny",
          },
        },
      });
      expect(parsed.shell_environment_policy).toEqual({
        set: {
          API_KEY: "from-config",
        },
      });
    } finally {
      cleanupDir(projectDir);
    }
  });
});
