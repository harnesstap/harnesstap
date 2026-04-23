import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OpenCodeSerializer } from "../../src/platforms/opencode.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const OPENCODE_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/opencode-project", import.meta.url),
);

describe("OpenCodeSerializer", () => {
  it("scans project resources", async () => {
    const serializer = new OpenCodeSerializer();
    const resources = await serializer.scan(OPENCODE_FIXTURE_DIR);

    expect(resources.map((r) => r.type)).toEqual(
      expect.arrayContaining(["instruction", "skill", "agent", "command", "mcp_server"]),
    );

    const instruction = resources.find((r) => r.type === "instruction");
    expect(instruction?.name).toBe("opencode-instructions");
    expect(instruction?.source).toBe("AGENTS.md");

    const skill = resources.find((r) => r.type === "skill");
    expect(skill?.name).toBe("research");
    expect(skill?.description).toBe("Research helper");

    const agent = resources.find((r) => r.type === "agent");
    expect(agent?.name).toBe("research");

    const command = resources.find((r) => r.type === "command");
    expect(command?.name).toBe("test");

    const mcps = resources.filter((r) => r.type === "mcp_server");
    expect(mcps.map((m) => m.name)).toEqual(["filesystem", "remote-server"]);
  });

  it("scans global resources", async () => {
    const serializer = new OpenCodeSerializer();
    const resources = await serializer.scanGlobal(OPENCODE_FIXTURE_DIR);

    expect(resources.map((r) => r.type)).toEqual(
      expect.arrayContaining(["skill", "agent", "command", "mcp_server"]),
    );

    const skill = resources.find((r) => r.type === "skill");
    expect(skill?.name).toBe("global-skill");

    const mcp = resources.find((r) => r.type === "mcp_server");
    expect(mcp?.name).toBe("global-mcp");
  });

  it("serializes resources to correct file paths", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({ type: "agent", name: "helper", content: "# Helper agent" }),
        makeResource({ type: "command", name: "test", content: "# Test command" }),
        makeResource({
          type: "mcp_server",
          name: "fs",
          metadata: { transport: "stdio", command: "npx", args: ["-y", "server"] },
        }),
        makeResource({
          type: "mcp_server",
          name: "remote",
          metadata: { transport: "http", url: "https://mcp.example.com" },
        }),
      ],
      ".",
    );

    const paths = files.map((f) => f.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".opencode/skills/research/SKILL.md");
    expect(paths).toContain(".opencode/agents/helper.md");
    expect(paths).toContain(".opencode/commands/test.md");
    expect(paths).toContain("opencode.json");
  });

  it("serializes instructions joined with double newline", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "a", content: "# First" }),
        makeResource({ type: "instruction", name: "b", content: "# Second" }),
      ],
      ".",
    );

    const agnts = files.find((f) => f.path === "AGENTS.md");
    expect(agnts?.content).toBe("# First\n\n# Second");
  });

  it("serializes MCP servers with correct format", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "fs",
          metadata: { transport: "stdio", command: "npx", args: ["-y", "server"], env: { KEY: "val" } },
        }),
        makeResource({
          type: "mcp_server",
          name: "http",
          metadata: { transport: "http", url: "https://mcp.example.com" },
        }),
      ],
      ".",
    );

    const config = files.find((f) => f.path === "opencode.json");
    expect(config).toBeDefined();
    if (!config) throw new Error("Expected OpenCode config file");
    const parsed = JSON.parse(config.content);
    expect(parsed).toEqual(
      expect.objectContaining({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          fs: {
            type: "local",
            command: ["npx", "-y", "server"],
            environment: { KEY: "val" },
            enabled: true,
          },
          http: {
            type: "remote",
            url: "https://mcp.example.com",
            enabled: true,
          },
        },
      }),
    );
  });

  it("skips non-.md files in agents and commands dirs", async () => {
    const projectDir = createTempDir("opencode-nonmd");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Instructions");
      writeTextFile(join(projectDir, ".opencode", "agents", "agent.md"), "# Agent");
      writeTextFile(join(projectDir, ".opencode", "agents", "skip.txt"), "# Not an agent");
      writeTextFile(join(projectDir, ".opencode", "commands", "cmd.md"), "# Command");
      writeTextFile(join(projectDir, ".opencode", "commands", "skip.yaml"), "# Not a command");

      const serializer = new OpenCodeSerializer();
      const resources = await serializer.scan(projectDir);

      const agents = resources.filter((r) => r.type === "agent");
      const commands = resources.filter((r) => r.type === "command");

      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("agent");
      expect(commands).toHaveLength(1);
      expect(commands[0]?.name).toBe("cmd");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("skips malformed opencode.json gracefully", async () => {
    const projectDir = createTempDir("opencode-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Instructions");
      writeTextFile(join(projectDir, "opencode.json"), "not valid json {{{");

      const serializer = new OpenCodeSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources.find((r) => r.type === "mcp_server")).toBeUndefined();
      expect(resources.find((r) => r.type === "instruction")).toBeDefined();
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("does not emit opencode.json when no MCP servers", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [makeResource({ type: "instruction", name: "intro", content: "# Intro" })],
      ".",
    );

    expect(files.find((f) => f.path === "opencode.json")).toBeUndefined();
  });

  it("does not emit AGENTS.md when no instructions", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "skill",
          name: "demo",
          description: "Demo",
          content: "# Demo",
        }),
      ],
      ".",
    );

    expect(files.find((f) => f.path === "AGENTS.md")).toBeUndefined();
  });

  it("handles empty resources", async () => {
    const serializer = new OpenCodeSerializer();
    const files = await serializer.serialize([], ".");
    expect(files).toEqual([]);
  });

  it("handles missing directories during scan", async () => {
    const projectDir = createTempDir("opencode-missing-dirs");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Instructions");

      const serializer = new OpenCodeSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources).toHaveLength(1);
      expect(resources[0]?.type).toBe("instruction");
    } finally {
      cleanupDir(projectDir);
    }
  });
});
