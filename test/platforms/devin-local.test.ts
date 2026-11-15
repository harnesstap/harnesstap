import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { GenericAgentsSerializer } from "../../src/platforms/generic-agents.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

type GlobalSerialize = {
  serialize: (
    resources: ReturnType<typeof makeResource>[],
    root: string,
    options: { target: "global" },
  ) => Promise<Array<{ path: string; content: string }>>;
};

const rule = makeResource({
  type: "rule",
  name: "ts-style",
  description: "TypeScript style",
  content: "Use bun.",
  metadata: { globs: ["**/*.ts"] },
});
const stdio = makeResource({
  type: "mcp_server",
  name: "local",
  metadata: { transport: "stdio", command: "npx", args: ["srv"], disabled_tools: ["drop"] },
});
const sse = makeResource({
  type: "mcp_server",
  name: "events",
  metadata: { transport: "http", url: "https://mcp.example.com/sse", http_transport: "sse" },
});

describe("Windsurf (Devin Local) and Devin CLI paths", () => {
  for (const platformId of ["windsurf", "devin"]) {
    it(`${platformId} writes rules with trigger frontmatter to .devin/rules/`, async () => {
      const files = await new GenericAgentsSerializer(platformId).serialize([rule], ".");
      const file = files.find((f) => f.path === ".devin/rules/ts-style.md");
      expect(file?.content).toBe(
        "---\ntrigger: glob\ndescription: TypeScript style\nglobs: '**/*.ts'\n---\nUse bun.\n",
      );
    });

    it(`${platformId} merges MCP servers into .devin/mcp_config.json`, async () => {
      const projectDir = createTempDir(`${platformId}-devin-mcp`);
      try {
        writeTextFile(
          join(projectDir, ".devin", "mcp_config.json"),
          JSON.stringify({ mcpServers: { mine: { command: "keep" } }, other: 1 }),
        );
        const files = await new GenericAgentsSerializer(platformId).serialize([stdio, sse], projectDir);
        const file = files.find((f) => f.path === ".devin/mcp_config.json");
        if (!file) throw new Error("Expected .devin/mcp_config.json");
        const parsed = JSON.parse(file.content);
        expect(parsed.other).toBe(1);
        expect(parsed.mcpServers).toEqual({
          mine: { command: "keep" },
          local: { command: "npx", args: ["srv"], disabledTools: ["drop"] },
          events: { url: "https://mcp.example.com/sse", transport: "sse" },
        });
      } finally {
        cleanupDir(projectDir);
      }
    });

    it(`${platformId} writes global MCP to ~/.config/devin/mcp_config.json`, async () => {
      const files = await (new GenericAgentsSerializer(platformId) as unknown as GlobalSerialize)
        .serialize([stdio], ".", { target: "global" });
      const paths = files.map((f) => f.path);
      expect(paths).toContain(".config/devin/mcp_config.json");
      expect(paths).not.toContain(".config/devin/config.json");
      expect(paths).not.toContain(".codeium/windsurf/mcp_config.json");
    });
  }

  it("windsurf writes skills natively and keeps .windsurfrules for instructions", async () => {
    const files = await new GenericAgentsSerializer("windsurf").serialize(
      [
        makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
        makeResource({
          type: "skill",
          name: "deploy",
          description: "Deploy",
          content: "---\nname: deploy\ndescription: Deploy\n---\nSteps",
        }),
      ],
      ".",
    );
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".windsurfrules");
    expect(paths).toContain(".agents/skills/deploy/SKILL.md");
    expect(files.find((f) => f.path === ".windsurfrules")?.content).not.toContain("Steps");
  });

  it("windsurf scans legacy .windsurf/rules and the old global MCP file", async () => {
    const projectDir = createTempDir("windsurf-legacy-scan");
    const homeDir = createTempDir("windsurf-legacy-home");
    try {
      writeTextFile(
        join(projectDir, ".windsurf", "rules", "old.md"),
        "---\ntrigger: always_on\n---\nOld rule\n",
      );
      writeTextFile(
        join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
        JSON.stringify({ mcpServers: { legacy: { command: "npx", args: ["legacy"] } } }),
      );
      const serializer = new GenericAgentsSerializer("windsurf");
      const project = await serializer.scan(projectDir);
      expect(project.find((r) => r.type === "rule")?.source).toBe(".windsurf/rules/old.md");

      const global = await serializer.scanGlobal(homeDir);
      expect(global.find((r) => r.type === "mcp_server")).toEqual(
        expect.objectContaining({ name: "legacy", source: "~/.codeium/windsurf/mcp_config.json" }),
      );

      // A server captured from the old file is written to the new one.
      const files = await (serializer as unknown as GlobalSerialize).serialize(
        [makeResource({
          type: "mcp_server",
          name: "legacy",
          source: "~/.codeium/windsurf/mcp_config.json",
          metadata: { transport: "stdio", command: "npx", args: ["legacy"] },
        })],
        homeDir,
        { target: "global" },
      );
      const config = files.find((f) => f.path === ".config/devin/mcp_config.json");
      expect(JSON.parse(config?.content ?? "{}").mcpServers?.legacy).toEqual({
        command: "npx",
        args: ["legacy"],
      });
    } finally {
      cleanupDir(projectDir);
      cleanupDir(homeDir);
    }
  });

  it("devin scans servers still in .devin/config.json", async () => {
    const projectDir = createTempDir("devin-config-mcp");
    try {
      writeTextFile(
        join(projectDir, ".devin", "config.json"),
        JSON.stringify({ mcpServers: { old: { command: "old" } }, model: "x" }),
      );
      writeTextFile(
        join(projectDir, ".devin", "mcp_config.json"),
        JSON.stringify({ mcpServers: { current: { command: "new" } } }),
      );
      const resources = await new GenericAgentsSerializer("devin").scan(projectDir);
      expect(
        resources.filter((r) => r.type === "mcp_server").map((r) => [r.name, r.source]),
      ).toEqual([
        ["current", ".devin/mcp_config.json"],
        ["old", ".devin/config.json"],
      ]);
    } finally {
      cleanupDir(projectDir);
    }
  });
});
