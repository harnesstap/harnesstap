import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse } from "smol-toml";
import { GrokBuildSerializer } from "../../src/platforms/grok-build.ts";
import { detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("GrokBuildSerializer", () => {
  it("scans instructions, skills, agents, hooks, mcp, and permissions", async () => {
    const projectDir = createTempDir("grok-build-scan");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Grok project\n");
      writeTextFile(
        join(projectDir, ".grok/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nReview carefully.\n",
      );
      writeTextFile(
        join(projectDir, ".grok/agents/explorer.md"),
        "---\nname: explorer\ndescription: Explore the codebase\n---\nSearch thoroughly.\n",
      );
      writeTextFile(
        join(projectDir, ".grok/hooks/safety.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "bin/check.sh", timeout: 10 }],
              },
            ],
          },
        }),
      );
      writeTextFile(
        join(projectDir, ".grok/config.toml"),
        `
[mcp_servers.docs]
command = "docs-mcp"
args = ["--root", "."]
env = { API_KEY = "\${DOCS_KEY}" }

[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
headers = { Authorization = "Bearer \${LINEAR_API_KEY}" }

[permission]
allow = ["Bash(git *)", "Read(src/**)"]
deny = ["Bash(*)"]
rules = [
  { action = "ask", tool = "Edit", pattern = "**/*.rs" },
]
`,
      );

      expect(detectPlatforms(projectDir)).toContain("grok-build");

      const serializer = new GrokBuildSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "instruction",
            source: "AGENTS.md",
          }),
          expect.objectContaining({
            type: "skill",
            name: "review",
          }),
          expect.objectContaining({
            type: "agent",
            name: "explorer",
            source: ".grok/agents/explorer.md",
          }),
          expect.objectContaining({
            type: "hook",
            source: ".grok/hooks/safety.json",
          }),
          expect.objectContaining({
            type: "mcp_server",
            name: "docs",
            metadata: expect.objectContaining({
              transport: "stdio",
              command: "docs-mcp",
            }),
          }),
          expect.objectContaining({
            type: "mcp_server",
            name: "linear",
            metadata: expect.objectContaining({
              transport: "http",
              url: "https://mcp.linear.app/mcp",
            }),
          }),
          expect.objectContaining({
            type: "permission",
            metadata: expect.objectContaining({
              action: "allow",
              pattern: "Bash(git *)",
            }),
          }),
          expect.objectContaining({
            type: "permission",
            metadata: expect.objectContaining({
              action: "ask",
              pattern: "Edit(**/*.rs)",
            }),
          }),
        ]),
      );
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("serializes mcp, permissions, agents, hooks, and skills", async () => {
    const serializer = new GrokBuildSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "grok", content: "# Grok" }),
        makeResource({
          type: "skill",
          name: "review",
          description: "Review helper",
          content: "# Review",
        }),
        makeResource({
          type: "agent",
          name: "explorer",
          description: "Explore",
          content: "Search thoroughly.",
        }),
        makeResource({
          type: "command",
          name: "ship",
          content: "# Ship\n",
        }),
        makeResource({
          type: "mcp_server",
          name: "docs",
          metadata: {
            transport: "stdio",
            command: "docs-mcp",
            args: ["--root", "."],
            env: { API_KEY: "${DOCS_KEY}" },
          },
        }),
        makeResource({
          type: "permission",
          name: "allow-git",
          metadata: { action: "allow", pattern: "Bash(git *)" },
        }),
        makeResource({
          type: "permission",
          name: "deny-bash",
          metadata: { action: "deny", pattern: "Bash(*)" },
        }),
        makeResource({
          type: "hook",
          name: "PreToolUse-Bash",
          content: "bin/check.sh",
          metadata: {
            event: "PreToolUse",
            script: "bin/check.sh",
            matcher: "Bash",
            timeout: 10,
          },
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".grok/skills/review/SKILL.md",
        ".grok/agents/explorer.md",
        ".agents/commands/ship.md",
        ".grok/config.toml",
        ".grok/hooks/harnesstap.json",
      ]),
    );

    const config = files.find((file) => file.path === ".grok/config.toml");
    expect(config).toBeDefined();
    const parsed = parse(config?.content ?? "") as Record<string, unknown>;
    expect(parsed.mcp_servers).toEqual(
      expect.objectContaining({
        docs: expect.objectContaining({
          command: "docs-mcp",
          args: ["--root", "."],
        }),
      }),
    );
    expect(parsed.permission).toEqual({
      allow: ["Bash(git *)"],
      deny: ["Bash(*)"],
    });

    const hooks = files.find((file) => file.path === ".grok/hooks/harnesstap.json");
    expect(hooks?.content).toContain("PreToolUse");
    expect(hooks?.content).toContain("bin/check.sh");
  });

  it("serializes model_config only for global target", async () => {
    const serializer = new GrokBuildSerializer();
    const projectFiles = await serializer.serialize(
      [
        makeResource({
          type: "model_config",
          name: "default",
          metadata: { model: "grok-build" },
        }),
      ],
      ".",
      { target: "project" },
    );
    expect(projectFiles).toEqual([]);

    const globalFiles = await serializer.serialize(
      [
        makeResource({
          type: "model_config",
          name: "default",
          metadata: { model: "grok-build" },
        }),
      ],
      ".",
      { target: "global" },
    );

    expect(globalFiles.map((file) => file.path)).toContain(".grok/config.toml");
    const parsed = parse(
      globalFiles.find((file) => file.path === ".grok/config.toml")?.content ?? "",
    ) as Record<string, unknown>;
    expect(parsed.models).toEqual({ default: "grok-build" });
  });
});
