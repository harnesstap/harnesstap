import { readFileSync } from "node:fs";
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
});
