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
      writeTextFile(`${context.projectDir}/CLAUDE.md`, "# Claude instructions");
      writeTextFile(
        `${context.projectDir}/AGENTS.md`,
        "# Generic instructions",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectPlatforms(context.projectDir);

      expect(detected).toContain("claude-code");
      expect(detected).toContain("codex");

      const results = await scanner.scanProject(
        context.projectDir,
        "claude-code",
      );
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
      writeTextFile(
        `${context.projectDir}/AGENTS.md`,
        "# Generic instructions",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const persisted = await scanner.scanAndPersist(context.projectDir);

      expect(
        persisted.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("detects and scans default home folders", async () => {
    const context = await createInitializedTestContext("scanner-home-defaults");

    try {
      writeTextFile(
        `${context.homeDir}/.claude/CLAUDE.md`,
        "# Home Claude instructions",
      );
      writeTextFile(
        `${context.homeDir}/.claude/skills/research/SKILL.md`,
        "---\nname: research\ndescription: Home research helper\n---\n# Research",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const detected = scanner.detectHomePlatforms();
      const claude = detected.find(
        (result) => result.platformId === "claude-code",
      );

      expect(claude?.discoveredPaths).toEqual(
        expect.arrayContaining(["~/.claude/CLAUDE.md", "~/.claude/skills/"]),
      );

      const results = await scanner.scanHomeDefaults();
      const homeClaude = results.find(
        (result) => result.platformId === "claude-code",
      );

      expect(homeClaude?.resources.map((resource) => resource.type)).toEqual(
        expect.arrayContaining(["instruction", "skill"]),
      );
      expect(
        homeClaude?.resources.find((resource) => resource.type === "skill")
          ?.source,
      ).toBe("~/.claude/skills/research/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });

  it("does not import overlapping home defaults on later runs", async () => {
    const context = await createInitializedTestContext("scanner-home-dedup");

    try {
      writeTextFile(
        `${context.homeDir}/.agents/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );
      writeTextFile(
        `${context.homeDir}/.cursor/skills/shared/SKILL.md`,
        "---\nname: shared\ndescription: Shared skill\n---\n# Shared",
      );

      const scanner = await import("../../src/services/scanner.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const firstRun = await scanner.scanAndPersistHomeDefaults();
      const secondRun = await scanner.scanAndPersistHomeDefaults();

      expect(
        firstRun.resources.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(1);
      expect(
        secondRun.resources.filter(
          (resource) => resource.type === "skill" && resource.name === "shared",
        ),
      ).toHaveLength(0);
      expect(
        resourceModel
          .listResources()
          .filter(
            (resource) =>
              resource.type === "skill" && resource.name === "shared",
          ),
      ).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });
});
