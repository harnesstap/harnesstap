import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("scanner services", () => {
  it("detects platforms and scans a filtered platform", async () => {
    const context = await createInitializedTestContext("scanner-filter");

    try {
      writeTextFile(
        `${context.projectDir}/.claude/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.projectDir}/CLAUDE.md`,
        "# Claude instructions",
      );
      writeTextFile(
        `${context.projectDir}/AGENTS.md`,
        "# Generic instructions",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectPlatforms(context.projectDir);

      expect(detected).toContain("claude-code");
      expect(detected).toContain("codex");

      const results = await scanner.scanProject(context.projectDir, "claude-code");
      expect(results).toHaveLength(1);
      expect(results[0]?.resources.map((resource) => resource.type)).toEqual(
        expect.arrayContaining(["instruction", "skill"]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("deduplicates resources by type and name when persisting", async () => {
    const context = await createInitializedTestContext("scanner-persist");

    try {
      writeTextFile(
        `${context.projectDir}/.claude/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.projectDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(`${context.projectDir}/AGENTS.md`, "# Generic instructions");

      const scanner = await import("../../src/services/scanner.ts");
      const persisted = await scanner.scanAndPersist(context.projectDir);

      expect(
        persisted.filter((resource) => resource.type === "skill" && resource.name === "shared"),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });
});
