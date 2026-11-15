import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { GenericAgentsSerializer } from "../../src/platforms/generic-agents.ts";
import { getPlatform } from "../../src/platforms/registry.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

describe("Kilo Code skills", () => {
  it("uses .kilo/skills/ and keeps .kilocode/skills/ as an earlier location", () => {
    const kilo = getPlatform("kilo");
    expect(kilo?.projectPaths.skills).toBe(".kilo/skills/");
    expect(kilo?.globalPaths.skills).toBe("~/.kilo/skills/");
    expect(kilo?.projectPaths.pathAlternates?.skills).toEqual([".kilocode/skills/"]);
    expect(kilo?.globalPaths.pathAlternates?.skills).toEqual(["~/.kilocode/skills/"]);
  });

  it("writes project skills to .kilo/skills/", async () => {
    const files = await new GenericAgentsSerializer("kilo").serialize(
      [
        makeResource({
          type: "skill",
          name: "deploy",
          description: "Deploy",
          content: "---\nname: deploy\ndescription: Deploy\n---\nSteps",
        }),
      ],
      ".",
    );
    expect(files.map((f) => f.path)).toContain(".kilo/skills/deploy/SKILL.md");
    expect(files.some((f) => f.path.startsWith(".kilocode/"))).toBe(false);
  });

  it("scans .kilocode/skills/ when .kilo/skills/ has no skill of that name", async () => {
    const projectDir = createTempDir("kilo-skills-scan");
    try {
      writeTextFile(
        join(projectDir, ".kilo", "skills", "shared", "SKILL.md"),
        "---\nname: shared\ndescription: New\n---\nNew",
      );
      writeTextFile(
        join(projectDir, ".kilocode", "skills", "shared", "SKILL.md"),
        "---\nname: shared\ndescription: Old\n---\nOld",
      );
      writeTextFile(
        join(projectDir, ".kilocode", "skills", "legacy", "SKILL.md"),
        "---\nname: legacy\ndescription: Legacy\n---\nLegacy",
      );
      const resources = await new GenericAgentsSerializer("kilo").scan(projectDir);
      const skills = resources.filter((r) => r.type === "skill");
      expect(skills.map((r) => [r.name, r.description])).toEqual([
        ["shared", "New"],
        ["legacy", "Legacy"],
      ]);
    } finally {
      cleanupDir(projectDir);
    }
  });
});
