import { existsSync, readFileSync } from "node:fs";
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

      expect(results.map((result) => result.platformId)).toEqual([
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

  it("materializes files in nested directories", async () => {
    const context = await createInitializedTestContext("applier-nested");

    try {
      const applier = await import("../../src/services/applier.ts");

      applier.writeFiles(
        [{ path: ".claude/skills/research/SKILL.md", content: "# Research" }],
        context.projectDir,
      );

      expect(
        readFileSync(join(context.projectDir, ".claude/skills/research/SKILL.md"), "utf-8"),
      ).toBe("# Research");
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites existing files when writing", async () => {
    const context = await createInitializedTestContext("applier-overwrite");

    try {
      const applier = await import("../../src/services/applier.ts");

      const filePath = join(context.projectDir, "existing.md");
      require("node:fs").writeFileSync(filePath, "old content", "utf-8");

      applier.writeFiles(
        [{ path: "existing.md", content: "new content" }],
        context.projectDir,
      );

      expect(readFileSync(filePath, "utf-8")).toBe("new content");
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
      expect(results[0]?.platformId).toBe("claude-code");
      expect(existsSync(join(context.projectDir, "CLAUDE.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("handles empty resources list", async () => {
    const context = await createInitializedTestContext("applier-empty");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles([], ["claude-code"], context.projectDir);

      expect(results).toHaveLength(1);
      expect(results[0]?.files).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("writes files for all generic agents platforms", async () => {
    const context = await createInitializedTestContext("applier-generic");

    try {
      const applier = await import("../../src/services/applier.ts");
      const results = await applier.generateFiles(
        [makeResource({ type: "instruction", name: "warp", content: "# Warp" })],
        ["warp", "amp"],
        context.projectDir,
      );

      expect(results.map((r) => r.platformId)).toEqual(["warp", "amp"]);
      expect(results[0]?.files.some((f) => f.path === "AGENTS.md")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
