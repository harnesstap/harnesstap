import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { executeSafeFileRemovals } from "../../src/services/safe-file-removal.ts";

describe("safe file removal with a user folder at a tracked path", () => {
  it("keeps the folder even with --force-remove and still removes the rest", async () => {
    const context = await createInitializedTestContext("safe-remove-user-folder");
    try {
      const root = ".claude/plugins/cache/m/p47/1.0.0";
      const file = `${root}/skills/s47/a.md`;
      const folder = `${root}/.claude-plugin/plugin.json`;
      mkdirSync(join(context.homeDir, root, "skills/s47"), { recursive: true });
      writeFileSync(join(context.homeDir, file), "a\n", "utf-8");
      mkdirSync(join(context.homeDir, folder), { recursive: true });
      writeFileSync(join(context.homeDir, folder, "u.txt"), "hi\n", "utf-8");

      const result = executeSafeFileRemovals(context.homeDir, [file, folder], { forceRemove: true });

      expect(result.removed).toEqual([file]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ path: folder, reason: "unmanaged" }),
      ]);
      expect(existsSync(join(context.homeDir, file))).toBe(false);
      expect(readFileSync(join(context.homeDir, folder, "u.txt"), "utf-8")).toBe("hi\n");
    } finally {
      await context.cleanup();
    }
  });
});
