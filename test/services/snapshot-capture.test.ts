import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { createTestContext } from "../helpers/db.ts";

describe("captureManagedSnapshotState", () => {
  it("records live bytes and marks missing generated paths absent", async () => {
    const context = await createTestContext("snapshot-capture-live");
    try {
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(join(context.projectDir, "KEEP.md"), "keep-me", "utf-8");
      const state = captureManagedSnapshotState({
        rootPath: context.projectDir,
        generated: [
          {
            platformId: "claude-code",
            files: [{ path: "CLAUDE.md" }, { path: "KEEP.md" }],
          },
        ],
        extraPaths: ["gone.md"],
      });
      expect(state.platform_files["claude-code"]?.["KEEP.md"]).toBe("keep-me");
      expect(state.absent_paths).toEqual(["CLAUDE.md", "gone.md"]);
    } finally {
      await context.cleanup();
    }
  });
});
