import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { MuseCodeSerializer } from "../../src/platforms/muse-code.ts";
import { detectHomePlatforms, detectPlatforms } from "../../src/services/scanner.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("MuseCodeSerializer project", () => {
  it("detects from .muse/hooks.json, not AGENTS.md or .agents/skills alone", () => {
    const sharedOnly = createTempDir("muse-shared-only");
    const withHooks = createTempDir("muse-hooks");
    try {
      writeTextFile(join(sharedOnly, "AGENTS.md"), "# Muse init only\n");
      writeTextFile(
        join(sharedOnly, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review\n---\nBody.\n",
      );
      expect(detectPlatforms(sharedOnly)).not.toContain("muse-code");

      writeTextFile(join(withHooks, ".muse/hooks.json"), '{"hooks":{}}\n');
      expect(detectPlatforms(withHooks)).toContain("muse-code");
    } finally {
      cleanupDir(sharedOnly);
      cleanupDir(withHooks);
    }
  });

  it("scans AGENTS.md, native skills, alternate skills without doubling, and project hooks", async () => {
    const projectDir = createTempDir("muse-scan");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Muse project\n");
      writeTextFile(
        join(projectDir, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom agents.\n",
      );
      writeTextFile(
        join(projectDir, ".claude/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\nFrom claude.\n",
      );
      writeTextFile(
        join(projectDir, ".codex/skills/extra/SKILL.md"),
        "---\nname: extra\ndescription: Extra\n---\nOnly codex.\n",
      );
      writeTextFile(
        join(projectDir, ".muse/hooks.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "bin/check.sh" }] },
            ],
          },
        }),
      );
      writeTextFile(join(projectDir, ".agents/memory/MEMORY.md"), "# Do not import\n");

      const resources = await new MuseCodeSerializer().scan(projectDir);
      const skills = resources.filter((r) => r.type === "skill");
      expect(skills.find((r) => r.name === "review")?.content).toContain("From agents.");
      expect(skills.filter((r) => r.name === "review")).toHaveLength(1);
      expect(skills.some((r) => r.name === "extra")).toBe(true);
      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "hook", source: ".muse/hooks.json" }),
        ]),
      );
      expect(resources.some((r) => r.type === "mcp_server")).toBe(false);
      expect(resources.some((r) => r.source?.includes("memory"))).toBe(false);
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("prefers AGENTS.md in the Muse instruction load order", async () => {
    const projectDir = createTempDir("muse-instruction-order");
    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Agents wins\n");
      writeTextFile(join(projectDir, "CLAUDE.md"), "# Claude later\n");

      const resources = await new MuseCodeSerializer().scan(projectDir);
      const instructions = resources.filter((r) => r.type === "instruction");
      expect(instructions).toHaveLength(1);
      expect(instructions[0]?.content).toContain("# Agents wins");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("emits AGENTS.md, .agents/skills, and .muse/hooks.json — not project MCP or memory", async () => {
    const files = await new MuseCodeSerializer().serialize(
      [
        makeResource({ type: "instruction", name: "muse", content: "# Muse" }),
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
        ".agents/skills/review/SKILL.md",
        ".muse/hooks.json",
      ]),
    );
    expect(files.map((file) => file.path)).not.toContain(".claude/skills/review/SKILL.md");
    expect(files.map((file) => file.path).join("\n")).not.toContain("memory");
    expect(files.some((file) => file.path.includes("settings.json"))).toBe(false);
    expect(files.find((file) => file.path === ".muse/hooks.json")?.content).toContain(
      "PreToolUse",
    );
  });
});

describe("MuseCodeSerializer global", () => {
  it("detects a Muse-only home from the muse config dir", () => {
    const homeDir = createTempDir("muse-home-detect");
    try {
      mkdirSync(join(homeDir, ".config/muse"), { recursive: true });
      const detected = detectHomePlatforms(homeDir).map((result) => result.platformId);
      expect(detected).toContain("muse-code");
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("scans mcp_servers and user hooks from settings.json without clobber keys", async () => {
    const homeDir = createTempDir("muse-home-scan");
    try {
      writeTextFile(
        join(homeDir, ".config/muse/settings.json"),
        JSON.stringify({
          schema_version: 1,
          telemetry: { enabled: false },
          mcp_servers: {
            docs: {
              transport: "stdio",
              command: "docs-mcp",
              args: ["--stdio"],
              enabled: true,
              mode: "optional",
            },
            remote: {
              transport: "streamable_http",
              url: "https://example.com/mcp",
              headers: { Authorization: "Bearer x" },
              enabled: true,
              mode: "required",
            },
          },
          hooks: {
            SessionStart: [{ command: "echo start" }],
          },
        }),
      );
      writeTextFile(
        join(homeDir, ".config/muse/skills/home-skill/SKILL.md"),
        "---\nname: home-skill\ndescription: Home\n---\nBody.\n",
      );
      writeTextFile(
        join(homeDir, ".claude/skills/home-skill/SKILL.md"),
        "---\nname: home-skill\ndescription: Home\n---\nFrom claude.\n",
      );

      const resources = await new MuseCodeSerializer().scanGlobal(homeDir);
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
          expect.objectContaining({ type: "hook", source: "~/.config/muse/settings.json" }),
          expect.objectContaining({ type: "skill", name: "home-skill" }),
        ]),
      );
      expect(resources.filter((r) => r.name === "home-skill")).toHaveLength(1);
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("merges settings.json: schema_version, mcp_servers shape, no clobber of unrelated keys", async () => {
    const homeDir = createTempDir("muse-home-merge");
    try {
      writeTextFile(
        join(homeDir, ".config/muse/settings.json"),
        JSON.stringify({
          schema_version: 1,
          telemetry: { enabled: false },
          runtime_capabilities: { observer_agents: true },
          managed_hooks_path: "/opt/muse/hooks.json",
          tui: { theme: "dark" },
          mcp_servers: {
            "keep-me": {
              transport: "stdio",
              command: "keep-mcp",
              enabled: true,
              mode: "required",
            },
          },
        }),
      );

      const files = await new MuseCodeSerializer().serialize(
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
            type: "hook",
            name: "SessionStart-1",
            content: "echo start",
            metadata: { event: "SessionStart", script: "echo start" },
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

      const settingsFile = files.find((file) => file.path === ".config/muse/settings.json");
      expect(settingsFile).toBeDefined();
      const parsed = JSON.parse(settingsFile?.content ?? "{}") as Record<string, unknown>;
      expect(parsed.schema_version).toBe(1);
      expect(parsed.telemetry).toEqual({ enabled: false });
      expect(parsed.runtime_capabilities).toEqual({ observer_agents: true });
      expect(parsed.managed_hooks_path).toBe("/opt/muse/hooks.json");
      expect(parsed.tui).toEqual({ theme: "dark" });
      expect(parsed.mcpServers).toBeUndefined();
      expect(parsed.mcp_servers).toEqual(
        expect.objectContaining({
          "keep-me": expect.objectContaining({
            transport: "stdio",
            command: "keep-mcp",
          }),
          docs: expect.objectContaining({
            transport: "stdio",
            command: "docs-mcp",
            enabled: true,
            mode: "required",
          }),
          remote: expect.objectContaining({
            transport: "streamable_http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer x" },
            enabled: true,
            mode: "required",
          }),
        }),
      );
      expect(parsed.hooks).toEqual(
        expect.objectContaining({
          SessionStart: expect.any(Array),
        }),
      );
      expect(files.map((file) => file.path)).toContain(
        ".config/muse/skills/home-skill/SKILL.md",
      );
      expect(files.map((file) => file.path)).not.toContain(
        ".claude/skills/home-skill/SKILL.md",
      );
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("sets schema_version: 1 when creating settings.json from a missing file", async () => {
    const homeDir = createTempDir("muse-home-create");
    try {
      const files = await new MuseCodeSerializer().serialize(
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
      const parsed = JSON.parse(
        files.find((file) => file.path === ".config/muse/settings.json")?.content ?? "{}",
      ) as Record<string, unknown>;
      expect(parsed.schema_version).toBe(1);
      expect(parsed.mcp_servers).toEqual(
        expect.objectContaining({
          docs: expect.objectContaining({ transport: "stdio", command: "docs-mcp" }),
        }),
      );
    } finally {
      cleanupDir(homeDir);
    }
  });
});
