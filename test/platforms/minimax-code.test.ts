import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { MiniMaxCodeSerializer } from "../../src/platforms/minimax-code.ts";
import { detectHomePlatforms, detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("MiniMaxCodeSerializer project", () => {
  it("detects from .minimax/skills or .minimax-plugin, not AGENTS.md or .agents/skills alone", () => {
    const sharedOnly = createTempDir("minimax-shared-only");
    const withSkills = createTempDir("minimax-skills");
    const withPlugin = createTempDir("minimax-plugin");
    try {
      writeTextFile(join(sharedOnly, "AGENTS.md"), "# MiniMax init only\n");
      writeTextFile(
        join(sharedOnly, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review\n---\nBody.\n",
      );
      expect(detectPlatforms(sharedOnly)).not.toContain("minimax-code");

      writeTextFile(
        join(withSkills, ".minimax/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review\n---\nBody.\n",
      );
      expect(detectPlatforms(withSkills)).toContain("minimax-code");

      writeTextFile(
        join(withPlugin, ".minimax-plugin/plugin.json"),
        '{"schemaVersion":1,"name":"demo"}\n',
      );
      expect(detectPlatforms(withPlugin)).toContain("minimax-code");
    } finally {
      cleanupDir(sharedOnly);
      cleanupDir(withSkills);
      cleanupDir(withPlugin);
    }
  });

  it("scans AGENTS.md, native skills, alternate skills without doubling, and project MCP", async () => {
    const projectDir = createTempDir("minimax-scan");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# MiniMax project\n");
      writeTextFile(
        join(projectDir, ".minimax/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom minimax.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom agents.\n",
      );
      writeTextFile(
        join(projectDir, ".claude/skills/extra/SKILL.md"),
        "---\nname: extra\ndescription: Extra\n---\nOnly claude.\n",
      );
      writeTextFile(
        join(projectDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            docs: { type: "stdio", command: "docs-mcp", args: ["--stdio"] },
          },
        }),
      );

      const resources = await new MiniMaxCodeSerializer().scan(projectDir);
      const skills = resources.filter((r) => r.type === "skill");
      expect(skills.find((r) => r.name === "review")?.content).toContain("From minimax.");
      expect(skills.filter((r) => r.name === "review")).toHaveLength(1);
      expect(skills.some((r) => r.name === "extra")).toBe(true);
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({
            type: "mcp_server",
            name: "docs",
            source: ".mcp.json",
          }),
        ]),
      );
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("prefers AGENTS.md in the MiniMax instruction load order", async () => {
    const projectDir = createTempDir("minimax-instruction-order");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Agents wins\n");
      writeTextFile(join(projectDir, "CLAUDE.md"), "# Claude later\n");

      const resources = await new MiniMaxCodeSerializer().scan(projectDir);
      const instructions = resources.filter((r) => r.type === "instruction");
      expect(instructions).toHaveLength(1);
      expect(instructions[0]?.content).toContain("# Agents wins");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("emits AGENTS.md, .minimax/skills, and merge-safe .mcp.json", async () => {
    const projectDir = createTempDir("minimax-serialize");
    try {
      writeTextFile(
        join(projectDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "keep-me": { type: "stdio", command: "keep-mcp" },
          },
          extra: true,
        }),
      );

      const files = await new MiniMaxCodeSerializer().serialize(
        [
          makeResource({ type: "instruction", name: "minimax", content: "# MiniMax" }),
          makeResource({
            type: "skill",
            name: "review",
            description: "Review helper",
            content: "# Review",
          }),
          makeResource({
            type: "mcp_server",
            name: "docs",
            metadata: { transport: "stdio", command: "docs-mcp" },
          }),
        ],
        projectDir,
        { target: "project" },
      );

      expect(files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "AGENTS.md",
          ".minimax/skills/review/SKILL.md",
          ".mcp.json",
        ]),
      );
      expect(files.map((file) => file.path)).not.toContain(".agents/skills/review/SKILL.md");
      const mcp = JSON.parse(
        files.find((file) => file.path === ".mcp.json")?.content ?? "{}",
      ) as Record<string, unknown>;
      expect(mcp.extra).toBe(true);
      expect(mcp.mcpServers).toEqual(
        expect.objectContaining({
          "keep-me": expect.objectContaining({ command: "keep-mcp" }),
          docs: expect.objectContaining({ type: "stdio", command: "docs-mcp" }),
        }),
      );
    } finally {
      cleanupDir(projectDir);
    }
  });
});

describe("MiniMaxCodeSerializer global", () => {
  it("detects a MiniMax home from the data dir, not the install dir", () => {
    const homeDir = createTempDir("minimax-home-detect");
    const installOnly = createTempDir("minimax-install-only");
    try {
      mkdirSync(join(homeDir, ".minimax"), { recursive: true });
      const detected = detectHomePlatforms(homeDir).map((result) => result.platformId);
      expect(detected).toContain("minimax-code");

      mkdirSync(join(installOnly, ".minimax-code/bin"), { recursive: true });
      const installDetected = detectHomePlatforms(installOnly).map(
        (result) => result.platformId,
      );
      expect(installDetected).not.toContain("minimax-code");
    } finally {
      cleanupDir(homeDir);
      cleanupDir(installOnly);
    }
  });

  it("detects the legacy ~/.mavis data dir", () => {
    const homeDir = createTempDir("minimax-legacy-home");
    try {
      mkdirSync(join(homeDir, ".mavis"), { recursive: true });
      const detected = detectHomePlatforms(homeDir).map((result) => result.platformId);
      expect(detected).toContain("minimax-code");
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("scans mcp.json servers and home skills without doubling", async () => {
    const homeDir = createTempDir("minimax-home-scan");
    try {
      writeTextFile(
        join(homeDir, ".minimax/mcp.json"),
        JSON.stringify({
          telemetry: { enabled: false },
          mcpServers: {
            docs: {
              type: "stdio",
              command: "docs-mcp",
              args: ["--stdio"],
              enabled: true,
            },
            remote: {
              type: "streamable-http",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer x" },
              enabled: true,
            },
          },
        }),
      );
      writeTextFile(
        join(homeDir, ".minimax/skills/home-skill/SKILL.md"),
        "---\nname: home-skill\ndescription: Home\n---\nBody.\n",
      );
      writeTextFile(
        join(homeDir, ".claude/skills/home-skill/SKILL.md"),
        "---\nname: home-skill\ndescription: Home\n---\nFrom claude.\n",
      );

      const resources = await new MiniMaxCodeSerializer().scanGlobal(homeDir);
      expect(resources).toEqual(
        expect.arrayContaining([
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
            name: "remote",
            metadata: expect.objectContaining({
              transport: "http",
              url: "https://example.com/mcp",
            }),
          }),
          expect.objectContaining({ type: "skill", name: "home-skill" }),
        ]),
      );
      expect(resources.filter((r) => r.name === "home-skill")).toHaveLength(1);
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("merges mcp.json servers without clobber of unrelated keys", async () => {
    const homeDir = createTempDir("minimax-home-merge");
    try {
      writeTextFile(
        join(homeDir, ".minimax/mcp.json"),
        JSON.stringify({
          telemetry: { enabled: false },
          mcpServers: {
            "keep-me": {
              type: "stdio",
              command: "keep-mcp",
              enabled: true,
            },
          },
        }),
      );

      const files = await new MiniMaxCodeSerializer().serialize(
        [
          makeResource({
            type: "mcp_server",
            name: "docs",
            metadata: { transport: "stdio", command: "docs-mcp", args: [] },
          }),
          makeResource({
            type: "mcp_server",
            name: "remote",
            metadata: {
              transport: "http",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer x" },
            },
          }),
          makeResource({
            type: "skill",
            name: "home-skill",
            description: "Home",
            content: "# Home",
          }),
        ],
        homeDir,
        { target: "global" },
      );

      const mcpFile = files.find((file) => file.path === ".minimax/mcp.json");
      expect(mcpFile).toBeDefined();
      const parsed = JSON.parse(mcpFile?.content ?? "{}") as Record<string, unknown>;
      expect(parsed.telemetry).toEqual({ enabled: false });
      expect(parsed.mcpServers).toEqual(
        expect.objectContaining({
          "keep-me": expect.objectContaining({
            type: "stdio",
            command: "keep-mcp",
          }),
          docs: expect.objectContaining({
            type: "stdio",
            command: "docs-mcp",
            enabled: true,
          }),
          remote: expect.objectContaining({
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer x" },
            enabled: true,
          }),
        }),
      );
      expect(files.map((file) => file.path)).toContain(
        ".minimax/skills/home-skill/SKILL.md",
      );
      expect(files.map((file) => file.path)).not.toContain(
        ".claude/skills/home-skill/SKILL.md",
      );
      expect(files.some((file) => file.path.includes("config.yaml"))).toBe(false);
    } finally {
      cleanupDir(homeDir);
    }
  });
});
