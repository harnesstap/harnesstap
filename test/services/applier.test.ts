import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

describe("applier services", () => {
  it("generates files for multiple platforms", async () => {
    const context = await createInitializedTestContext("applier-generate");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles(
        [
          makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
          makeResource({ type: "skill", name: "shared", description: "Shared skill" }),
        ],
        ["claude-code", "codex"],
        context.projectDir,
      );

      expect(results.map((result) => result.harnessId)).toEqual([
        "claude-code",
        "codex",
      ]);
      expect(results[0]?.files.some((file) => file.path === "CLAUDE.md")).toBe(true);
      expect(results[1]?.files.some((file) => file.path === "AGENTS.md")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("writes generated files to disk", async () => {
    const context = await createInitializedTestContext("applier-write");

    try {
      const applier = await import("../../src/services/applier.ts");
      applier.writeFiles(
        [{ path: ".claude/skills/demo/SKILL.md", content: "# Demo" }],
        context.projectDir,
      );

      expect(
        readFileSync(`${context.projectDir}/.claude/skills/demo/SKILL.md`, "utf-8"),
      ).toBe("# Demo");
    } finally {
      await context.cleanup();
    }
  });

  it("throws when alias content conflicts with main at the same path", async () => {
    const applier = await import("../../src/services/applier.ts");

    const mainFiles = [{ path: "AGENTS.md", content: "main content" }];
    const aliasFiles = [{ path: "AGENTS.md", content: "different content" }];

    expect(() => applier.planAliasWrites(mainFiles, aliasFiles)).toThrow(
      "Alias output conflicts with the main harness at AGENTS.md",
    );
  });

  it("creates symlinks when alias content matches main content at different path", async () => {
    const applier = await import("../../src/services/applier.ts");

    const mainFiles = [{ path: "CLAUDE.md", content: "shared content" }];
    const aliasFiles = [{ path: "AGENTS.md", content: "shared content" }];

    const planned = applier.planAliasWrites(mainFiles, aliasFiles);

    expect(planned).toEqual([
      {
        path: "AGENTS.md",
        content: "shared content",
        symlinkTarget: "CLAUDE.md",
      },
    ]);
  });

  it("writes unique alias content without symlink", async () => {
    const applier = await import("../../src/services/applier.ts");

    const mainFiles = [{ path: "CLAUDE.md", content: "main only" }];
    const aliasFiles = [{ path: "AGENTS.md", content: "unique alias" }];

    const planned = applier.planAliasWrites(mainFiles, aliasFiles);

    expect(planned).toEqual([
      { path: "AGENTS.md", content: "unique alias" },
    ]);
  });

  it("skips alias files that match main at the same path", async () => {
    const applier = await import("../../src/services/applier.ts");

    const mainFiles = [
      { path: "CLAUDE.md", content: "same" },
      { path: "AGENTS.md", content: "same" },
    ];
    const aliasFiles = [{ path: "AGENTS.md", content: "same" }];

    const planned = applier.planAliasWrites(mainFiles, aliasFiles);

    expect(planned).toEqual([]);
  });

  it("handles empty main and alias file lists", async () => {
    const applier = await import("../../src/services/applier.ts");

    expect(applier.planAliasWrites([], [])).toEqual([]);
    expect(applier.planAliasWrites([{ path: "a.md", content: "x" }], [])).toEqual([]);
  });

  it("materializes symlinks with correct relative paths", async () => {
    const context = await createInitializedTestContext("applier-symlink");

    try {
      const applier = await import("../../src/services/applier.ts");

      const plannedFiles = [
        { path: "CLAUDE.md", content: "main content" },
        { path: "AGENTS.md", content: "main content", symlinkTarget: "CLAUDE.md" },
      ];

      applier.materializePlannedFiles(plannedFiles, context.projectDir);

      expect(readFileSync(join(context.projectDir, "CLAUDE.md"), "utf-8")).toBe("main content");

      const linkPath = join(context.projectDir, "AGENTS.md");
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

      const symlinkTarget = require("node:fs").readlinkSync(linkPath);
      expect(symlinkTarget).toBe("CLAUDE.md");
    } finally {
      await context.cleanup();
    }
  });

  it("materializes files in nested directories", async () => {
    const context = await createInitializedTestContext("applier-nested");

    try {
      const applier = await import("../../src/services/applier.ts");

      applier.materializePlannedFiles(
        [
          { path: ".claude/skills/research/SKILL.md", content: "# Research" },
        ],
        context.projectDir,
      );

      expect(
        readFileSync(join(context.projectDir, ".claude/skills/research/SKILL.md"), "utf-8"),
      ).toBe("# Research");
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites existing regular files when materializing", async () => {
    const context = await createInitializedTestContext("applier-overwrite");

    try {
      const applier = await import("../../src/services/applier.ts");

      const filePath = join(context.projectDir, "existing.md");
      require("node:fs").writeFileSync(filePath, "old content", "utf-8");

      applier.materializePlannedFiles(
        [{ path: "existing.md", content: "new content" }],
        context.projectDir,
      );

      expect(readFileSync(filePath, "utf-8")).toBe("new content");
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites existing directories when materializing", async () => {
    const context = await createInitializedTestContext("applier-dir-overwrite");

    try {
      const applier = await import("../../src/services/applier.ts");

      const dirPath = join(context.projectDir, "existing-dir");
      require("node:fs").mkdirSync(dirPath, { recursive: true });
      require("node:fs").writeFileSync(join(dirPath, "old.txt"), "old", "utf-8");

      applier.materializePlannedFiles(
        [{ path: "existing-dir", content: "new file" }],
        context.projectDir,
      );

      expect(existsSync(join(context.projectDir, "existing-dir"))).toBe(true);
      expect(readFileSync(join(context.projectDir, "existing-dir"), "utf-8")).toBe("new file");
    } finally {
      await context.cleanup();
    }
  });

  it("applies to project with full pipeline", async () => {
    const context = await createInitializedTestContext("applier-apply");

    try {
      const applier = await import("../../src/services/applier.ts");

      const resources = [
        makeResource({ type: "instruction", name: "intro", content: "# Intro" }),
      ];

      const results = await applier.applyToProject(
        resources,
        ["claude-code"],
        context.projectDir,
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.harnessId).toBe("claude-code");
      expect(existsSync(join(context.projectDir, "CLAUDE.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
