import { describe, expect, it } from "bun:test";
import { applyOutcomeFromUnknown, applySuccessToast } from "../../apps/desktop/src/lib/apply-result.ts";

describe("desktop apply result counts", () => {
  it("counts unchanged files on a no-op home apply", () => {
    const outcome = applyOutcomeFromUnknown({
      written_files: [],
      removed_files: [],
      files: Array.from({ length: 19 }, (_, index) => `.file-${index}`),
      skipped_files: Array.from({ length: 19 }, (_, index) => `.file-${index}`),
      snapshot_id: "snap-1",
    });
    expect(outcome.wrote).toBe(0);
    expect(outcome.unchanged).toBe(19);
    expect(applySuccessToast({
      written_files: [],
      removed_files: [],
      files: outcome.wrote === 0 ? Array.from({ length: 19 }, (_, index) => `.file-${index}`) : [],
      snapshot_id: "snap-1",
    }).title).toBe("Everything is up to date. 19 unchanged.");
  });

  it("counts kept files on a switch that writes and removes nothing", () => {
    const result = {
      home: {
        apply: {
          written_files: [],
          removed_files: [],
          files: Array.from({ length: 27 }, (_, index) => `.kept-peer-${index}`),
          removals: {
            owned_unmodified: [],
            owned_modified: [".agents/skills/tiny-skill/SKILL.md"],
            unmanaged: [".claude/rules/security.md", ".codex/agents/a.toml"],
          },
          skipped_removals: [
            { path: ".agents/skills/tiny-skill/SKILL.md", reason: "modified" },
            { path: ".claude/rules/security.md", reason: "preexisting" },
            { path: ".codex/agents/a.toml", reason: "unmanaged" },
          ],
        },
      },
    };
    const outcome = applyOutcomeFromUnknown(result);
    expect(outcome.wrote).toBe(0);
    expect(outcome.removed).toBe(0);
    expect(outcome.kept).toBe(3);
    expect(outcome.unchanged).toBe(27);
    expect(applySuccessToast(result).title).toBe("Wrote 0, removed 0, kept 3");
  });
});
