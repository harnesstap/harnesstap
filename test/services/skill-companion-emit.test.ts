import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateFiles, writeFiles } from "../../src/services/applier.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";
import { statSync } from "node:fs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);

function seedCompanionSkill(skillDir: string): void {
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  mkdirSync(join(skillDir, "references"), { recursive: true });
  mkdirSync(join(skillDir, "assets"), { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: big-review\ndescription: Review\n---\nSee references/checklist.md\n",
  );
  writeFileSync(join(skillDir, "NOTES.md"), "notes body\n");
  writeFileSync(join(skillDir, "scripts/lint.sh"), "#!/bin/sh\necho lint\n");
  chmodSync(join(skillDir, "scripts/lint.sh"), 0o755);
  writeFileSync(join(skillDir, "references/checklist.md"), "# checklist\n");
  writeFileSync(join(skillDir, "assets/logo.png"), PNG);
}

function companionResource(source: string, originRef: string) {
  return makeResource({
    type: "skill",
    name: "big-review",
    description: "Review",
    content: "See references/checklist.md\n",
    source,
    origin_ref: originRef,
    metadata: {
      scripts: ["lint.sh"],
      references: ["checklist.md"],
      companions: [
        "NOTES.md",
        "assets/logo.png",
        "references/checklist.md",
        "scripts/lint.sh",
      ],
    },
  });
}

function assertCompanionPaths(paths: string[], prefix: string): void {
  expect(paths).toContain(`${prefix}/SKILL.md`);
  expect(paths).toContain(`${prefix}/NOTES.md`);
  expect(paths).toContain(`${prefix}/scripts/lint.sh`);
  expect(paths).toContain(`${prefix}/references/checklist.md`);
  expect(paths).toContain(`${prefix}/assets/logo.png`);
  expect(paths.some((path) => /(^|\/)reference\//.test(path))).toBe(false);
}

describe("skill companion emit", () => {
  it("emits a verbatim tree for home and project harness paths", async () => {
    const sourceRoot = createTempDir("skill-companion-source");
    try {
      seedCompanionSkill(join(sourceRoot, ".claude/skills/big-review"));
      const context = await createInitializedTestContext("skill-companion-emit");
      try {
        const resource = companionResource(
          ".claude/skills/big-review/SKILL.md",
          sourceRoot,
        );
        const home = await generateFiles(
          [resource],
          ["claude-code", "cursor"],
          context.homeDir,
          { target: "global", skillSourceRoot: sourceRoot },
        );
        const homePaths = home.flatMap((result) => result.files.map((file) => file.path));
        assertCompanionPaths(homePaths, ".claude/skills/big-review");

        const project = await generateFiles(
          [resource],
          ["claude-code"],
          context.projectDir,
          { target: "project", skillSourceRoot: sourceRoot },
        );
        const projectPaths = project.flatMap((result) => result.files.map((file) => file.path));
        assertCompanionPaths(projectPaths, ".claude/skills/big-review");

        const lint = project
          .flatMap((result) => result.files)
          .find((file) => file.path.endsWith("scripts/lint.sh"));
        expect(lint?.mode).toBe(0o755);
        const logo = project
          .flatMap((result) => result.files)
          .find((file) => file.path.endsWith("assets/logo.png"));
        expect(logo?.encoding).toBe("base64");

        writeFiles(project[0]?.files ?? [], context.projectDir);
        expect(statSync(join(context.projectDir, ".claude/skills/big-review/scripts/lint.sh")).mode & 0o777).toBe(
          0o755,
        );
      } finally {
        await context.cleanup();
      }
    } finally {
      cleanupDir(sourceRoot);
    }
  });

  it("Desktop preview (24d) does not plan a singular reference/ file", async () => {
    const context = await createInitializedTestContext("skill-companion-preview");
    try {
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const skillDir = join(context.homeDir, ".claude/skills/big-review");
      seedCompanionSkill(skillDir);

      const profile = createPlugin({ name: "global default" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "big-review",
        description: "Review",
        content: "See references/checklist.md\n",
        source: "~/.claude/skills/big-review/SKILL.md",
        origin_kind: "local_snapshot",
        origin_ref: context.homeDir,
        metadata: {
          companions: [
            "NOTES.md",
            "assets/logo.png",
            "references/checklist.md",
            "scripts/lint.sh",
          ],
        },
      });
      addResourceToPlugin(profile.id, skill.id);

      const preview = await previewProfileApply({
        profile: "global default",
        scope: "home",
        harness: "claude-code",
      });
      const planned = preview.files.changes.map((change) => change.path);
      expect(planned.some((path) => /(^|\/)reference\//.test(path))).toBe(false);

      const generated = await generateFiles(
        [skill],
        ["claude-code"],
        context.homeDir,
        { target: "global", skillSourceRoot: context.homeDir },
      );
      const generatedPaths = generated.flatMap((result) => result.files.map((file) => file.path));
      expect(generatedPaths.some((path) => /(^|\/)reference\//.test(path))).toBe(false);
      expect(generatedPaths.some((path) => path.endsWith("references/checklist.md"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
