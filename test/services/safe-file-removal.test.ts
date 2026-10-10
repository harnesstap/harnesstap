import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.ts";
import { recordPreexistingPath } from "../../src/models/preexisting-path.ts";
import {
  executeSafeFileRemovals,
  isApplyTrashTarget,
  restoreSafeRemovalBackup,
} from "../../src/services/safe-file-removal.ts";

describe("safe file removal", () => {
  it("keeps unmanaged extras, skips edited owned files, and backs up matching owned files", async () => {
    const context = await createInitializedTestContext("safe-remove-cases");
    try {
      const skillDir = join(context.homeDir, ".cursor", "skills", "ship");
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      const notesPath = join(skillDir, "my-notes.md");
      const editedPath = join(context.homeDir, ".cursor", "skills", "edited", "SKILL.md");
      mkdirSync(join(editedPath, ".."), { recursive: true });
      writeFileSync(skillPath, "# Ship\n", "utf-8");
      writeFileSync(notesPath, "my private notes\n", "utf-8");
      writeFileSync(editedPath, "# changed by user\n", "utf-8");

      const owned = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# Ship",
        metadata: {},
        source: "manual",
      });
      const edited = createResource({
        type: "skill",
        name: "edited",
        description: "",
        content: "# Edited",
        metadata: {},
        source: "manual",
      });
      recordResourceMaterialization({
        resource_id: owned.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/skills/ship/SKILL.md",
        action: "delete-file",
        ownership_key: "skill:ship",
        generated_hash: hashGeneratedContent("# Ship\n"),
      });
      recordResourceMaterialization({
        resource_id: edited.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "cursor",
        path: ".cursor/skills/edited/SKILL.md",
        action: "delete-file",
        ownership_key: "skill:edited",
        generated_hash: hashGeneratedContent("# Edited\n"),
      });

      const originalRm = fs.rmSync.bind(fs);
      const spy = spyOn(fs, "rmSync").mockImplementation((target, opts) => {
        if (
          opts &&
          typeof opts === "object" &&
          "recursive" in opts &&
          (opts as { recursive?: boolean }).recursive
        ) {
          if (!isApplyTrashTarget(String(target))) {
            throw new Error(`recursive rmSync forbidden: ${String(target)}`);
          }
        }
        return originalRm(target, opts);
      });

      const result = executeSafeFileRemovals(
        context.homeDir,
        [
          ".cursor/skills/ship/SKILL.md",
          ".cursor/skills/ship/my-notes.md",
          ".cursor/skills/edited/SKILL.md",
        ],
      );

      expect(result.removed).toEqual([".cursor/skills/ship/SKILL.md"]);
      expect(result.skipped.map((entry) => entry.reason).sort()).toEqual([
        "modified",
        "unmanaged",
      ]);
      expect(existsSync(skillPath)).toBe(false);
      expect(readFileSync(notesPath, "utf-8")).toBe("my private notes\n");
      expect(readFileSync(editedPath, "utf-8")).toBe("# changed by user\n");
      expect(existsSync(skillDir)).toBe(true);

      const restored = restoreSafeRemovalBackup({
        applyId: result.applyId,
        rootPath: context.homeDir,
      });
      expect(restored).toContain(".cursor/skills/ship/SKILL.md");
      expect(readFileSync(skillPath, "utf-8")).toBe("# Ship\n");
      spy.mockRestore();
    } finally {
      await context.cleanup();
    }
  });

  it("never removes a preexisting path even with --force-remove", async () => {
    const context = await createInitializedTestContext("safe-remove-preexisting");
    try {
      const relative = ".cursor/skills/cursor-only-skill/SKILL.md";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "Cursor specific guidance.\n", "utf-8");
      recordPreexistingPath({
        root_path: context.homeDir,
        path: relative,
        content_hash: hashGeneratedContent("Cursor specific guidance.\n"),
      });

      const result = executeSafeFileRemovals(context.homeDir, [relative], {
        forceRemove: true,
      });
      expect(result.removed).toEqual([]);
      expect(result.skipped[0]?.reason).toBe("preexisting");
      expect(readFileSync(full, "utf-8")).toBe("Cursor specific guidance.\n");
    } finally {
      await context.cleanup();
    }
  });
});
