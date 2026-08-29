import { describe, expect, it } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { inspectApmOverlay, skippedRootSourceWarning } from "../../src/services/apm-overlay.ts";
import { BundleSymlinkError } from "../../src/utils/path-containment.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

describe("inspectApmOverlay", () => {
  it("collects native primitives plus instructions and prompts from .apm/", () => {
    const root = createTempDir("apm-overlay-collect");
    try {
      writeTextFile(
        join(root, ".apm", "skills", "ship", "SKILL.md"),
        `---
name: ship
description: Ship checklist
---
Run the checklist.
`,
      );
      writeTextFile(join(root, ".apm", "skills", "ship", "scripts", "go.sh"), "echo go\n");
      writeTextFile(
        join(root, ".apm", "agents", "reviewer.agent.md"),
        `---
name: reviewer
description: Reviews diffs
---
Be thorough.
`,
      );
      writeTextFile(join(root, ".apm", "commands", "draft.md"), "# Draft\n");
      writeTextFile(
        join(root, ".apm", "instructions", "style.instructions.md"),
        `---
description: Style
applyTo: "src/**/*.ts"
---
Use spaces.
`,
      );
      writeTextFile(
        join(root, ".apm", "instructions", "always.instructions.md"),
        `---
description: Always
---
Be kind.
`,
      );
      writeTextFile(
        join(root, ".apm", "prompts", "review.prompt.md"),
        `---
description: Review
---
Review this.
`,
      );
      writeTextFile(
        join(root, ".apm", "hooks", "hooks.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [{ command: "echo pre" }],
          },
        }),
      );

      const overlay = inspectApmOverlay(root);
      expect(overlay?.fromApm).toBe(true);
      expect(overlay?.skills).toEqual([
        expect.objectContaining({
          name: "ship",
          skillMdRelative: ".apm/skills/ship/SKILL.md",
          metadata: { scripts: ["go.sh"] },
        }),
      ]);
      expect(overlay?.primitives.map((primitive) => `${primitive.type}:${primitive.name}`).sort()).toEqual([
        "agent:reviewer",
        "command:draft",
        "command:review",
        "hook:PreToolUse-1",
        "instruction:always",
        "rule:style",
        "skill:ship",
      ]);
      expect(overlay?.primitives.find((primitive) => primitive.name === "style")?.metadata).toEqual({
        globs: ["src/**/*.ts"],
        always_apply: false,
      });
    } finally {
      cleanupDir(root);
    }
  });

  it("skips root primitive dirs when .apm/ is present", () => {
    const root = createTempDir("apm-overlay-skip-root");
    try {
      writeTextFile(join(root, ".apm", "skills", "kept", "SKILL.md"), "# Kept\n");
      writeTextFile(join(root, "skills", "skipped", "SKILL.md"), "# Skipped\n");
      const overlay = inspectApmOverlay(root);
      expect(overlay?.skippedRootDirs).toEqual(["skills"]);
      expect(overlay?.warnings).toContain(skippedRootSourceWarning("skills"));
      expect(overlay?.skills.map((skill) => skill.name)).toEqual(["kept"]);
    } finally {
      cleanupDir(root);
    }
  });

  it("reads root primitive dirs when .apm/ is absent", () => {
    const root = createTempDir("apm-overlay-root");
    try {
      writeTextFile(join(root, "agents", "review.md"), "# Review\n");
      writeTextFile(join(root, "skills", "ship", "SKILL.md"), "# Ship\n");
      const overlay = inspectApmOverlay(root);
      expect(overlay?.fromApm).toBe(false);
      expect(overlay?.primitives.map((primitive) => `${primitive.type}:${primitive.name}`).sort()).toEqual([
        "agent:review",
        "skill:ship",
      ]);
    } finally {
      cleanupDir(root);
    }
  });

  it("honors compilation.exclude", () => {
    const root = createTempDir("apm-overlay-exclude");
    try {
      writeTextFile(join(root, ".apm", "skills", "kept", "SKILL.md"), "# Kept\n");
      writeTextFile(join(root, ".apm", "skills", "tmp", "SKILL.md"), "# Tmp\n");
      const overlay = inspectApmOverlay(root, { exclude: [".apm/skills/tmp/**"] });
      expect(overlay?.skills.map((skill) => skill.name)).toEqual(["kept"]);
    } finally {
      cleanupDir(root);
    }
  });

  it("rejects a symlink under .apm/", () => {
    const root = createTempDir("apm-overlay-symlink");
    try {
      mkdirSync(join(root, ".apm", "skills", "ship"), { recursive: true });
      writeTextFile(join(root, ".apm", "skills", "ship", "SKILL.md"), "# Ship\n");
      symlinkSync(
        join(root, ".apm", "skills", "ship", "SKILL.md"),
        join(root, ".apm", "skills", "ship", "copy.md"),
      );
      expect(() => inspectApmOverlay(root)).toThrow(BundleSymlinkError);
    } finally {
      cleanupDir(root);
    }
  });
});
