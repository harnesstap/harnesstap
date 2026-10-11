import { afterEach, describe, expect, it } from "bun:test";
import {
  printApplyDryRun,
  printApplySuccess,
} from "../../src/cli/print-apply-summary.ts";

describe("apply dry-run and success copy (W2-2, DS-6)", () => {
  const logs: string[] = [];
  const originalLog = console.log;

  function capture(): void {
    logs.length = 0;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };
  }

  afterEach(() => {
    console.log = originalLog;
  });

  it("lists files and prints Would write/remove/keep with unchanged", () => {
    capture();
    printApplyDryRun({
      wouldWrite: ["~/.claude/CLAUDE.md", "~/.cursor/rules/ht.mdc"],
      wouldRemove: ["~/.claude/settings.json"],
      wouldKeep: [{ path: "~/AGENTS.md", reason: "modified" }],
      unchanged: 28,
    });
    const output = logs.join("\n");
    expect(output).toContain("Dry run. Nothing was changed.");
    expect(output).toContain("Would write (2)");
    expect(output).toContain("~/.claude/CLAUDE.md");
    expect(output).toContain("~/.cursor/rules/ht.mdc");
    expect(output).toContain("Would remove (1)");
    expect(output).toContain("~/.claude/settings.json");
    expect(output).toContain("Would keep (1)");
    expect(output).toContain("~/AGENTS.md");
    expect(output).toContain("Would write 2, remove 1, keep 1. 28 unchanged.");
  });

  it("skips the generic header for stash dry-run", () => {
    capture();
    printApplyDryRun({
      wouldWrite: [],
      wouldRemove: ["~/.claude/CLAUDE.md"],
      wouldKeep: [],
      unchanged: 0,
      header: false,
    });
    const output = logs.join("\n");
    expect(output).not.toContain("Dry run. Nothing was changed.");
    expect(output).toContain("Would remove (1)");
    expect(output).toContain("Would write 0, remove 1, keep 0. 0 unchanged.");
  });

  it("prints the success summary line in DS-6 order", () => {
    capture();
    printApplySuccess({
      name: "global default",
      harnessCount: 2,
      wrote: 3,
      removed: 1,
      kept: [{ path: "AGENTS.md", reason: "unmanaged" }],
      unchanged: 28,
      snapshotId: "snap-1",
    });
    const output = logs.join("\n");
    expect(output).toContain('Applied "global default" to 2 harnesses.');
    expect(output).toContain("Wrote 3, removed 1, kept 1, unchanged 28.");
    expect(output).toContain("ht revert snap-1");
  });
});
