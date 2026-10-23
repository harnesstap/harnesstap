import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { detectProjectDrift } from "../../src/services/project-drift.ts";
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
            files: [
              { path: "CLAUDE.md", content: "# generated" },
              { path: "KEEP.md", content: "# generated-keep" },
            ],
          },
        ],
        extraPaths: ["gone.md"],
      });
      expect(state.platform_files["claude-code"]?.["KEEP.md"]).toBe("# generated-keep");
      expect(state.platform_files["claude-code"]?.["CLAUDE.md"]).toBe("# generated");
      expect(state.disk_files?.["KEEP.md"]).toBe("keep-me");
      expect(state.absent_paths).toEqual(["CLAUDE.md", "gone.md"]);
    } finally {
      await context.cleanup();
    }
  });

  it("records a base64 file as the text the disk reads back, so it is not reported as drift", async () => {
    const context = await createTestContext("snapshot-capture-base64");
    try {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
      mkdirSync(join(context.projectDir, "assets"), { recursive: true });
      writeFileSync(join(context.projectDir, "assets/icon.png"), bytes);
      writeFileSync(join(context.projectDir, "assets/note.txt"), "plain", "utf-8");
      const state = captureManagedSnapshotState({
        rootPath: context.projectDir,
        generated: [
          {
            platformId: "claude-code",
            files: [
              { path: "assets/icon.png", content: bytes.toString("base64"), encoding: "base64" },
              { path: "assets/note.txt", content: "plain", encoding: "utf8" },
            ],
          },
        ],
      });
      const drift = detectProjectDrift(context.projectDir, { id: "s", label: "l", state });
      expect(drift.changes).toEqual([]);

      writeFileSync(join(context.projectDir, "assets/icon.png"), Buffer.from([0x01, 0x02, 0x03]));
      const changed = detectProjectDrift(context.projectDir, { id: "s", label: "l", state });
      expect(changed.changes.map((change) => change.path)).toEqual(["assets/icon.png"]);
    } finally {
      await context.cleanup();
    }
  });
});
