import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  emitSkillAuxiliaryFiles,
  listSkillAuxiliaryFiles,
} from "../../src/services/skill-auxiliary.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("skill-auxiliary", () => {
  it("lists scripts and reference files from skill directory", () => {
    const listed = listSkillAuxiliaryFiles(
      join(fixture, ".claude/skills/impeccable"),
    );
    expect(listed.scripts).toContain("context.mjs");
    expect(listed.references).toContain("polish.md");
  });

  it("emits auxiliary files under target skill prefix", () => {
    const files = emitSkillAuxiliaryFiles({
      sourceSkillDir: join(fixture, ".claude/skills/impeccable"),
      targetPrefix: ".claude/skills/impeccable",
      scripts: ["context.mjs"],
      references: ["polish.md"],
    });
    expect(files.map((f) => f.path)).toEqual([
      ".claude/skills/impeccable/scripts/context.mjs",
      ".claude/skills/impeccable/reference/polish.md",
    ]);
    expect(files[0]?.content).toContain("//");
  });
});
