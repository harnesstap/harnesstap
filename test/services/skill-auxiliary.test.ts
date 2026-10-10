import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emitSkillAuxiliaryFiles,
  listSkillAuxiliaryFiles,
} from "../../src/services/skill-auxiliary.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("skill-auxiliary", () => {
  it("lists scripts and reference files from skill directory", () => {
    const listed = listSkillAuxiliaryFiles(
      join(fixture, ".claude/skills/impeccable"),
    );
    expect(listed.scripts).toContain("context.mjs");
    expect(listed.references).toContain("polish.md");
    expect(listed.companions).toContain("scripts/context.mjs");
    expect(listed.companions).toContain("reference/polish.md");
  });

  it("emits auxiliary files under the original relative paths", () => {
    const files = emitSkillAuxiliaryFiles({
      sourceSkillDir: join(fixture, ".claude/skills/impeccable"),
      targetPrefix: ".claude/skills/impeccable",
    });
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        ".claude/skills/impeccable/scripts/context.mjs",
        ".claude/skills/impeccable/scripts/command-metadata.json",
        ".claude/skills/impeccable/reference/polish.md",
        ".claude/skills/impeccable/reference/audit.md",
      ]),
    );
    expect(files.map((f) => f.path)).not.toContain(
      ".claude/skills/impeccable/reference/checklist.md",
    );
    expect(files.some((f) => f.path.includes("/reference/") && f.path.endsWith("polish.md"))).toBe(
      true,
    );
    expect(files[0]?.content.length).toBeGreaterThan(0);
  });

  it("copies the whole companion tree with bytes and mode", () => {
    const root = createTempDir("skill-companion-tree");
    try {
      const skillDir = join(root, "big-review");
      mkdirSync(join(skillDir, "scripts"), { recursive: true });
      mkdirSync(join(skillDir, "references"), { recursive: true });
      mkdirSync(join(skillDir, "assets"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: big-review\n---\nsee references/checklist.md\n");
      writeFileSync(join(skillDir, "NOTES.md"), "notes\n");
      writeFileSync(join(skillDir, "scripts/lint.sh"), "#!/bin/sh\necho ok\n");
      chmodSync(join(skillDir, "scripts/lint.sh"), 0o755);
      writeFileSync(join(skillDir, "references/checklist.md"), "# checklist\n");
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
      writeFileSync(join(skillDir, "assets/logo.png"), png);

      const listed = listSkillAuxiliaryFiles(skillDir);
      expect(listed.companions.sort()).toEqual([
        "NOTES.md",
        "assets/logo.png",
        "references/checklist.md",
        "scripts/lint.sh",
      ].sort());
      expect(listed.references).toEqual(["checklist.md"]);

      const files = emitSkillAuxiliaryFiles({
        sourceSkillDir: skillDir,
        targetPrefix: ".claude/skills/big-review",
      });
      expect(files.map((file) => file.path).sort()).toEqual([
        ".claude/skills/big-review/NOTES.md",
        ".claude/skills/big-review/assets/logo.png",
        ".claude/skills/big-review/references/checklist.md",
        ".claude/skills/big-review/scripts/lint.sh",
      ]);
      expect(files.some((file) => file.path.includes("/reference/"))).toBe(false);

      const script = files.find((file) => file.path.endsWith("scripts/lint.sh"));
      expect(script?.mode).toBe(0o755);

      const logo = files.find((file) => file.path.endsWith("assets/logo.png"));
      expect(logo?.encoding).toBe("base64");
      expect(Buffer.from(logo?.content ?? "", "base64").equals(png)).toBe(true);
    } finally {
      cleanupDir(root);
    }
  });
});
