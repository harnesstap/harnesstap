import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { CopilotSerializer } from "../../src/platforms/copilot.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const COPILOT_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/copilot-project", import.meta.url),
);

describe("CopilotSerializer", () => {
  it("scans github-copilot project resources", async () => {
    const serializer = new CopilotSerializer("github-copilot");
    const resources = await serializer.scan(COPILOT_FIXTURE_DIR);

    // github-copilot has no projectPaths.mcp, so only instruction + skill
    expect(resources.map((r) => r.type)).toEqual(
      expect.arrayContaining(["instruction", "skill"]),
    );

    const instruction = resources.find((r) => r.type === "instruction");
    expect(instruction?.name).toBe("github-copilot-instructions");
    expect(instruction?.source).toBe(".github/copilot-instructions.md");

    const skill = resources.find((r) => r.type === "skill");
    expect(skill?.name).toBe("api-skill");
    expect(skill?.description).toBe("API helper");

    // No MCP in project paths for github-copilot
    expect(resources.find((r) => r.type === "mcp_server")).toBeUndefined();
  });

  it("scans copilot-cli project resources", async () => {
    const projectDir = createTempDir("copilot-cli-scan");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Copilot CLI instructions");
      writeTextFile(
        join(projectDir, ".copilot", "mcp-config.json"),
        JSON.stringify({
          mcpServers: {
            "cli-server": { command: "npx", args: ["cli-server"] },
          },
        }),
      );

      const serializer = new CopilotSerializer("copilot-cli");
      const resources = await serializer.scan(projectDir);

      expect(resources.map((r) => r.type)).toEqual(
        expect.arrayContaining(["instruction", "mcp_server"]),
      );

      const instruction = resources.find((r) => r.type === "instruction");
      expect(instruction?.name).toBe("copilot-cli-instructions");
      expect(instruction?.source).toBe("AGENTS.md");

      const mcp = resources.find((r) => r.type === "mcp_server");
      expect(mcp?.name).toBe("cli-server");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("scans global resources for github-copilot", async () => {
    const serializer = new CopilotSerializer("github-copilot");
    const resources = await serializer.scanGlobal(COPILOT_FIXTURE_DIR);

    expect(resources.map((r) => r.type)).toEqual(
      expect.arrayContaining(["skill", "mcp_server"]),
    );

    const skill = resources.find((r) => r.type === "skill");
    expect(skill?.name).toBe("global-copilot-skill");

    const mcpNames = resources.filter((r) => r.type === "mcp_server").map((m) => m.name);
    expect(mcpNames).toContain("http-server");
  });

  it("serializes github-copilot resources", async () => {
    const serializer = new CopilotSerializer("github-copilot");
    const files = await serializer.serialize(
      [
        makeResource({
          type: "instruction",
          name: "intro",
          content: "# GitHub instructions",
        }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "mcp_server",
          name: "fs",
          metadata: { transport: "stdio", command: "npx", args: ["-y", "fs-server"] },
        }),
        makeResource({
          type: "mcp_server",
          name: "http",
          metadata: { transport: "http", url: "https://mcp.example.com" },
        }),
      ],
      ".",
    );

    const paths = files.map((f) => f.path);
    expect(paths).toContain(".github/copilot-instructions.md");
    expect(paths.some((p) => p.includes(".agents/skills"))).toBe(false);

    const instructions = files.find((f) => f.path === ".github/copilot-instructions.md");
    expect(instructions?.content).toContain("# GitHub instructions");
    expect(instructions?.content).toContain("## research");
    expect(instructions?.content).toContain("# Research");
  });

  it("serializes copilot-cli resources", async () => {
    const serializer = new CopilotSerializer("copilot-cli");
    const files = await serializer.serialize(
      [
        makeResource({
          type: "instruction",
          name: "intro",
          content: "# CLI instructions",
        }),
        makeResource({
          type: "mcp_server",
          name: "cli",
          metadata: { transport: "stdio", command: "npx", args: ["cli"] },
        }),
      ],
      ".",
    );

    const paths = files.map((f) => f.path);
    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain(".copilot/mcp-config.json");
  });

  it("serializes copilot-cli global resources into global paths", async () => {
    const serializer = new CopilotSerializer("copilot-cli");
    const files = await (serializer as unknown as {
      serialize: (
        resources: ReturnType<typeof makeResource>[],
        root: string,
        options: { target: "global" },
      ) => Promise<Array<{ path: string; content: string }>>;
    }).serialize(
      [
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "mcp_server",
          name: "cli",
          metadata: { transport: "stdio", command: "npx", args: ["cli"] },
        }),
      ],
      ".",
      { target: "global" },
    );

    const paths = files.map((file) => file.path);
    expect(paths).toContain(".copilot/skills/research/SKILL.md");
    expect(paths).toContain(".copilot/mcp-config.json");
    expect(paths).not.toContain(".agents/skills/research/SKILL.md");
  });

  it("serializes MCP servers with tools: [\"*\"] for copilot", async () => {
    const serializer = new CopilotSerializer("github-copilot");
    const githubFiles = await serializer.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "local",
          metadata: { transport: "stdio", command: "python3", args: ["srv.py"], env: { KEY: "v" } },
        }),
        makeResource({
          type: "mcp_server",
          name: "remote",
          metadata: { transport: "http", url: "https://mcp.example.com" },
        }),
      ],
      ".",
    );

    // github-copilot doesn't have an mcp project path, so no config emitted
    expect(
      githubFiles.find((file) => file.path === ".copilot/mcp-config.json"),
    ).toBeUndefined();
    // Let's test with copilot-cli which has one
    const serializer2 = new CopilotSerializer("copilot-cli");
    const files2 = await serializer2.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "local",
          metadata: { transport: "stdio", command: "python3", args: ["srv.py"], env: { KEY: "v" } },
        }),
        makeResource({
          type: "mcp_server",
          name: "remote",
          metadata: { transport: "http", url: "https://mcp.example.com" },
        }),
      ],
      ".",
    );

    const config2 = files2.find((f) => f.path === ".copilot/mcp-config.json");
    expect(config2).toBeDefined();
    if (!config2) throw new Error("Expected Copilot MCP config file");
    const parsed = JSON.parse(config2.content);
    expect(parsed.mcpServers.local).toEqual(
      expect.objectContaining({
        type: "local",
        command: "python3",
        args: ["srv.py"],
        env: { KEY: "v" },
        tools: ["*"],
      }),
    );
    expect(parsed.mcpServers.remote).toEqual(
      expect.objectContaining({
        type: "http",
        url: "https://mcp.example.com",
        tools: ["*"],
      }),
    );
  });

  it("supports both mcpServers and mcp keys in config", async () => {
    const projectDir = createTempDir("copilot-mcp-key");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Instructions");
      writeTextFile(
        join(projectDir, ".copilot", "mcp-config.json"),
        JSON.stringify({
          mcp: {
            legacy: { command: "old-server" },
          },
        }),
      );

      const serializer = new CopilotSerializer("copilot-cli");
      const resources = await serializer.scan(projectDir);

      const mcp = resources.find((r) => r.type === "mcp_server");
      expect(mcp?.name).toBe("legacy");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("skips malformed MCP config gracefully", async () => {
    const projectDir = createTempDir("copilot-malformed");

    try {
      writeTextFile(join(projectDir, ".github", "copilot-instructions.md"), "# Instructions");
      writeTextFile(join(projectDir, ".copilot", "mcp-config.json"), "{ not json }");

      const serializer = new CopilotSerializer("github-copilot");
      const resources = await serializer.scan(projectDir);

      expect(resources.find((r) => r.type === "mcp_server")).toBeUndefined();
      expect(resources.find((r) => r.type === "instruction")).toBeDefined();
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("does not emit MCP config when no MCP servers", async () => {
    const serializer = new CopilotSerializer("copilot-cli");
    const files = await serializer.serialize(
      [makeResource({ type: "instruction", name: "intro", content: "# Intro" })],
      ".",
    );

    expect(files.find((f) => f.path === ".copilot/mcp-config.json")).toBeUndefined();
  });

  it("emits skills-only github-copilot resources into copilot-instructions.md", async () => {
    const serializer = new CopilotSerializer("github-copilot");
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

    const instructions = files.find((f) => f.path === ".github/copilot-instructions.md");
    expect(instructions).toBeDefined();
    expect(instructions?.content).toContain("## demo");
    expect(instructions?.content).toContain("# Demo");
    expect(files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
  });

  it("handles empty resources", async () => {
    const serializer = new CopilotSerializer("github-copilot");
    const files = await serializer.serialize([], ".");
    expect(files).toEqual([]);
  });

  it("handles missing directories during scan", async () => {
    const projectDir = createTempDir("copilot-missing");

    try {
      const serializer = new CopilotSerializer("copilot-cli");
      const resources = await serializer.scan(projectDir);
      expect(resources).toEqual([]);
    } finally {
      cleanupDir(projectDir);
    }
  });
});
