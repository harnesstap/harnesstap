import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  listMaterializationsForRootPath,
  recordResourceMaterialization,
} from "../../src/models/resource-materialization.ts";
import {
  hashGeneratedContent,
  persistWrittenMaterializations,
} from "../../src/services/materialization-ownership.ts";
import { recordPreexistingPath } from "../../src/models/preexisting-path.ts";
import {
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
  isHarnessTapOwnedPath,
  planSafeFileRemovals,
  restoreSafeRemovalBackup,
  skippedWriteKeepsForOwnership,
} from "../../src/services/safe-file-removal.ts";

describe("safe file removal", () => {
  it("only uses recursive rmSync in the apply trash pruner", () => {
    const removal = readFileSync(
      join(import.meta.dir, "../../src/services/safe-file-removal.ts"),
      "utf-8",
    );
    const recursiveCalls = [...removal.matchAll(/rmSync\([\s\S]*?\)/g)].filter((match) =>
      match[0].includes("recursive"),
    );
    expect(recursiveCalls).toHaveLength(1);
    expect(recursiveCalls[0]?.[0]).toContain("extra.full");
    const applier = readFileSync(
      join(import.meta.dir, "../../src/services/applier.ts"),
      "utf-8",
    );
    expect(applier).not.toMatch(/rmSync\(/);
  });

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
    } finally {
      await context.cleanup();
    }
  });

  it("never re-owns a file whose hash no longer matches the last write", async () => {
    const context = await createInitializedTestContext("ownership-hash-mismatch");
    try {
      const relative = ".claude/skills/cursor-only-skill/SKILL.md";
      const full = join(context.homeDir, relative);
      mkdirSync(join(full, ".."), { recursive: true });
      const original = "---\nname: cursor-only-skill\n---\nCursor specific guidance.\n";
      const edited = `${original}\nUSER-EDIT-SENTINEL\n`;
      writeFileSync(full, original, "utf-8");

      const resource = createResource({
        type: "skill",
        name: "cursor-only-skill",
        description: "",
        content: original,
        metadata: {},
        source: "manual",
      });
      const originalHash = hashGeneratedContent(original);
      recordResourceMaterialization({
        resource_id: resource.id,
        scope: "global",
        root_path: context.homeDir,
        platform_id: "claude-code",
        path: relative,
        action: "delete-file",
        ownership_key: "skill:cursor-only-skill",
        generated_hash: originalHash,
      });

      writeFileSync(full, edited, "utf-8");
      expect(classifyManagedPathOwnership(context.homeDir, relative)).toBe("modified");
      expect(isHarnessTapOwnedPath(context.homeDir, relative)).toBe(false);

      persistWrittenMaterializations({
        scope: "global",
        root_path: context.homeDir,
        platformResults: [{
          platformId: "claude-code",
          files: [{
            path: relative,
            content: edited,
            ownership: [{
              resource_id: resource.id,
              action: "delete-file",
              ownership_key: "skill:cursor-only-skill",
              managed_container: false,
            }],
          }],
          writtenPaths: [],
        }],
      });
      expect(listMaterializationsForRootPath(context.homeDir, relative)[0]?.generated_hash)
        .toBe(originalHash);
      expect(classifyManagedPathOwnership(context.homeDir, relative)).toBe("modified");

      const planned = planSafeFileRemovals(context.homeDir, [relative]);
      expect(planned.remove).toEqual([]);
      expect(planned.skip.map((entry) => entry.reason)).toEqual(["modified"]);
      expect(skippedWriteKeepsForOwnership(context.homeDir, [relative]).map((entry) => entry.reason))
        .toEqual(["modified"]);
      expect(readFileSync(full, "utf-8")).toBe(edited);
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
