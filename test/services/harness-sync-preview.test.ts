import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countHarnessSyncChanges } from "../../src/services/harness-sync-preview.ts";

describe("countHarnessSyncChanges", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "ht-harness-sync-preview-"));
    tempDirs.push(dir);
    return dir;
  }

  it("counts missing files as changes on the harness that would emit them", () => {
    const rootPath = tempRoot();
    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      results: [
        {
          platformId: "claude-code",
          files: [{ path: ".claude/skills/alpha/SKILL.md", content: "claude\n" }],
        },
        {
          platformId: "cursor",
          files: [{ path: ".agents/skills/alpha/SKILL.md", content: "cursor\n" }],
        },
      ],
      paired: {
        files: [
          { path: ".claude/skills/alpha/SKILL.md", content: "claude\n" },
          { path: ".agents/skills/alpha/SKILL.md", content: "cursor\n" },
        ],
        links: [],
      },
      skillHubPlans: [],
      target: "project",
      rootPath,
      pluginResourceMode: "symlink",
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 1 },
      { harness: "cursor", changes: 1 },
    ]);
  });

  it("skips files whose on-disk contents already match", () => {
    const rootPath = tempRoot();
    mkdirSync(join(rootPath, ".claude/skills/alpha"), { recursive: true });
    writeFileSync(join(rootPath, ".claude/skills/alpha/SKILL.md"), "claude\n");

    const rows = countHarnessSyncChanges({
      platforms: ["claude-code", "cursor"],
      results: [
        {
          platformId: "claude-code",
          files: [{ path: ".claude/skills/alpha/SKILL.md", content: "claude\n" }],
        },
        {
          platformId: "cursor",
          files: [{ path: ".agents/skills/alpha/SKILL.md", content: "cursor\n" }],
        },
      ],
      paired: {
        files: [
          { path: ".claude/skills/alpha/SKILL.md", content: "claude\n" },
          { path: ".agents/skills/alpha/SKILL.md", content: "cursor\n" },
        ],
        links: [],
      },
      skillHubPlans: [],
      target: "project",
      rootPath,
      pluginResourceMode: "symlink",
    });
    expect(rows).toEqual([
      { harness: "claude-code", changes: 0 },
      { harness: "cursor", changes: 1 },
    ]);
  });
});
