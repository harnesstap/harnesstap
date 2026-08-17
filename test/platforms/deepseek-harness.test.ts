import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { DeepSeekHarnessSerializer } from "../../src/platforms/deepseek-harness.ts";
import { detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("DeepSeekHarnessSerializer project", () => {
  it("scans instructions, preferred skills, alternate skills, and hooks", async () => {
    const projectDir = createTempDir("dsh-scan");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# DSH project\n");
      writeTextFile(join(projectDir, "CLAUDE.md"), "# DSH project\n");
      writeTextFile(
        join(projectDir, ".dsh/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom dsh.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom agents.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/skills/extra/SKILL.md"),
        "---\nname: extra\ndescription: Extra\n---\nOnly agents.\n",
      );
      writeTextFile(
        join(projectDir, ".dsh/hooks/safety.json"),
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

      expect(detectPlatforms(projectDir)).toContain("deepseek-harness");

      const resources = await new DeepSeekHarnessSerializer().scan(projectDir);
      const skills = resources.filter((r) => r.type === "skill");
      expect(skills.find((r) => r.name === "review")?.content).toContain("From dsh.");
      expect(skills.filter((r) => r.name === "review")).toHaveLength(1);
      expect(skills.some((r) => r.name === "extra")).toBe(true);
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "hook", source: ".dsh/hooks/safety.json" }),
        ]),
      );
      expect(resources.some((r) => r.type === "mcp_server")).toBe(false);
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("serializes project files without a home patch", async () => {
    const files = await new DeepSeekHarnessSerializer().serialize(
      [
        makeResource({ type: "instruction", name: "dsh", content: "# DSH" }),
        makeResource({
          type: "skill",
          name: "review",
          description: "Review helper",
          content: "# Review",
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
        makeResource({
          type: "mcp_server",
          name: "docs",
          metadata: { transport: "stdio", command: "docs-mcp" },
        }),
      ],
      ".",
      { target: "project" },
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".dsh/skills/review/SKILL.md",
        ".dsh/hooks/harnesstap.json",
      ]),
    );
    expect(files.map((file) => file.path).join("\n")).not.toContain("cordis.patch.yml");
    expect(files.find((file) => file.path === ".dsh/hooks/harnesstap.json")?.content).toContain(
      "PreToolUse",
    );
  });
});

describe("DeepSeekHarnessSerializer global", () => {
  it("scans home patch MCP, hooks, settings, and user presets", async () => {
    const homeDir = createTempDir("dsh-home-scan");
    try {
      writeTextFile(join(homeDir, ".dsh/AGENTS.md"), "# Home\n");
      writeTextFile(
        join(homeDir, ".dsh/skills/home-skill/SKILL.md"),
        "---\nname: home-skill\ndescription: Home\n---\nBody.\n",
      );
      writeTextFile(
        join(homeDir, ".dsh/cordis.patch.yml"),
        `
- insert:
    - id: user-memory
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memory
        transport: stdio
        command: memory-mcp
    - id: harnesstap-mcp-linear
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: linear
        transport: streamable-http
        url: https://mcp.linear.app/mcp
`,
      );
      writeTextFile(
        join(homeDir, ".dsh/hooks/harnesstap.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "bin/check.sh" }] },
            ],
          },
        }),
      );
      writeTextFile(
        join(homeDir, ".dsh/settings.yaml"),
        "agent-default-model:\n  provider: deepseek\n  model: deepseek-chat\npermission:\n  defaultPreset: workspace-write\n",
      );
      writeTextFile(
        join(homeDir, ".dsh/.agent-presets/explorer/preset.yml"),
        "name: Explorer\ndescription: Explore the repo\n",
      );
      writeTextFile(
        join(homeDir, ".dsh/.agent-presets/explorer/agent.cordis.yml"),
        "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: Search thoroughly.\n    complete: false\n",
      );
      writeTextFile(
        join(homeDir, ".dsh/profiles/web/node_modules/turtle-ui/package.json"),
        JSON.stringify({
          name: "turtle-ui",
          version: "1.2.3",
          description: "Turtle UI",
          dsh: { bundle: { patch: "./cordis.patch.yml" } },
        }),
      );

      const resources = await new DeepSeekHarnessSerializer().scanGlobal(homeDir);
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "~/.dsh/AGENTS.md" }),
          expect.objectContaining({ type: "skill", name: "home-skill" }),
          expect.objectContaining({
            type: "mcp_server",
            name: "memory",
            metadata: expect.objectContaining({ transport: "stdio", command: "memory-mcp" }),
          }),
          expect.objectContaining({
            type: "mcp_server",
            name: "linear",
            metadata: expect.objectContaining({
              transport: "http",
              url: "https://mcp.linear.app/mcp",
            }),
          }),
          expect.objectContaining({ type: "hook" }),
          expect.objectContaining({
            type: "model_config",
            metadata: expect.objectContaining({ model: "deepseek-chat" }),
          }),
          expect.objectContaining({
            type: "permission",
            metadata: expect.objectContaining({ pattern: "workspace-write" }),
          }),
          expect.objectContaining({
            type: "agent",
            name: "explorer",
            content: expect.stringContaining("Search thoroughly."),
          }),
          expect.objectContaining({ type: "plugin", name: "turtle-ui" }),
        ]),
      );
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("merges harnesstap rows into an existing home patch on global apply", async () => {
    const homeDir = createTempDir("dsh-home-apply");
    try {
      writeTextFile(
        join(homeDir, ".dsh/cordis.patch.yml"),
        "- insert:\n    - id: user-memory\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: memory\n        transport: stdio\n        command: memory-mcp\n",
      );
      writeTextFile(join(homeDir, ".dsh/settings.yaml"), "llm-pi-ai:\n  keep: true\n");

      const files = await new DeepSeekHarnessSerializer().serialize(
        [
          makeResource({
            type: "mcp_server",
            name: "docs",
            metadata: { transport: "stdio", command: "docs-mcp" },
          }),
          makeResource({
            type: "hook",
            name: "PreToolUse-Bash",
            content: "bin/check.sh",
            metadata: { event: "PreToolUse", script: "bin/check.sh", matcher: "Bash" },
          }),
          makeResource({
            type: "model_config",
            name: "default",
            metadata: { model: "deepseek-chat", provider: "deepseek" },
          }),
          makeResource({
            type: "permission",
            name: "default",
            metadata: { action: "allow", pattern: "workspace-write" },
          }),
          makeResource({
            type: "agent",
            name: "explorer",
            description: "Explore",
            content: "Search thoroughly.",
          }),
          makeResource({
            type: "permission",
            name: "deny-bash",
            metadata: { action: "deny", pattern: "Bash(*)" },
          }),
        ],
        homeDir,
        { target: "global" },
      );

      const patch = files.find((file) => file.path.endsWith("cordis.patch.yml"));
      expect(patch).toBeDefined();
      expect(patch?.content).toContain("user-memory");
      expect(patch?.content).toContain("harnesstap-mcp-docs");
      expect(patch?.content).toContain("harnesstap-hooks-claude-code");
      expect(patch?.content).toContain("docs-mcp");

      expect(files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          ".dsh/hooks/harnesstap.json",
          ".dsh/settings.yaml",
          ".dsh/.agent-presets/explorer/preset.yml",
          ".dsh/.agent-presets/explorer/agent.cordis.yml",
        ]),
      );
      const settings = files.find((file) => file.path.endsWith("settings.yaml"));
      expect(settings?.content).toContain("keep: true");
      expect(settings?.content).toContain("deepseek-chat");
      expect(settings?.content).toContain("workspace-write");
      expect(settings?.content).not.toContain("Bash(*)");

      const again = await new DeepSeekHarnessSerializer().serialize(
        [
          makeResource({
            type: "mcp_server",
            name: "docs",
            metadata: { transport: "stdio", command: "docs-mcp" },
          }),
        ],
        homeDir,
        { target: "global" },
      );
      const patchAgain = again.find((file) => file.path.endsWith("cordis.patch.yml"));
      expect(patchAgain?.content.match(/harnesstap-mcp-docs/g)?.length).toBe(1);
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("throws on invalid home patch and emits no files", async () => {
    const homeDir = createTempDir("dsh-bad-patch");
    try {
      writeTextFile(join(homeDir, ".dsh/cordis.patch.yml"), "not-a-list: true\n");
      await expect(
        new DeepSeekHarnessSerializer().serialize(
          [
            makeResource({
              type: "mcp_server",
              name: "docs",
              metadata: { transport: "stdio", command: "docs-mcp" },
            }),
            makeResource({ type: "skill", name: "review", content: "# Review" }),
          ],
          homeDir,
          { target: "global" },
        ),
      ).rejects.toThrow(/list of patch operations/);
    } finally {
      cleanupDir(homeDir);
    }
  });
});
