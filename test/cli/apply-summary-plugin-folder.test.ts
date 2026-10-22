import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { settleKeptHostPluginViewFiles } from "../../src/cli/handlers/host-plugin-view-kept.ts";
import { printApplySuccess } from "../../src/cli/print-apply-summary.ts";
import {
  recordAddedHostPluginViewFiles,
  recordReplacedHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin-view-policy.ts";

const hostView = "/home/u/.claude/plugins/cache/mkta/p47/1.0.0";

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ""));
  });
  const error = spyOn(console, "error").mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ""));
  });
  return {
    lines,
    restore: () => {
      log.mockRestore();
      error.mockRestore();
    },
  };
}

afterEach(() => {
  takeReplacedHostPluginViewFiles();
});

describe("apply summary with plugin cache folder changes", () => {
  it("counts files a plugin folder refresh replaced instead of saying Wrote 0", () => {
    recordReplacedHostPluginViewFiles({
      hostView,
      backupId: "01TEST",
      files: ["skills/s47/SKILL.md", "skills/s47/b.md"],
      notWrittenByHarnessTap: [],
      removed: [],
    });
    const out = capture();
    try {
      printApplySuccess({
        name: "pr",
        harnessCount: 1,
        wrote: 0,
        removed: 0,
        kept: [],
        unchanged: 6,
      });
    } finally {
      out.restore();
    }
    const text = out.lines.join("\n");
    expect(text).toContain("Wrote 2, unchanged 6.");
    expect(text).not.toContain("Wrote 0");
    expect(text).not.toContain("Everything is up to date");
  });

  it("counts new plugin files next to replaced ones", () => {
    recordReplacedHostPluginViewFiles({
      hostView,
      backupId: "01TEST",
      files: ["skills/s47/SKILL.md", "skills/s47/b.md"],
      notWrittenByHarnessTap: [],
      removed: ["skills/s47/b.md"],
    });
    recordAddedHostPluginViewFiles(hostView, ["skills/s47/d.md"]);
    recordAddedHostPluginViewFiles(hostView, ["skills/s47/d.md"]);
    const out = capture();
    try {
      printApplySuccess({ name: "pr", harnessCount: 1, wrote: 0, removed: 0, kept: [], unchanged: 6 });
    } finally {
      out.restore();
    }
    expect(out.lines.join("\n")).toContain("Wrote 2, removed 1, unchanged 6.");
  });

  it("counts removals as removals and says so in the backup notice", async () => {
    recordReplacedHostPluginViewFiles({
      hostView,
      backupId: "01TEST",
      files: ["skills/s47/SKILL.md", "skills/s47/a.md", "skills/s47/b.md"],
      notWrittenByHarnessTap: [],
      removed: ["skills/s47/SKILL.md", "skills/s47/a.md", "skills/s47/b.md"],
    });
    const out = capture();
    try {
      printApplySuccess({
        name: "pr",
        harnessCount: 1,
        wrote: 0,
        removed: 0,
        kept: [],
        unchanged: 4,
      });
      await settleKeptHostPluginViewFiles({}, {
        interactive: false,
        confirm: async () => false,
        take: () => [],
        takeReplaced: takeReplacedHostPluginViewFiles,
        replace: () => ({ paths: [] }),
      });
    } finally {
      out.restore();
    }
    const text = out.lines.join("\n");
    expect(text).toContain("Removed 3, unchanged 4.");
    expect(text).not.toContain("Everything is up to date");
    expect(text).toContain("Backed up and removed 3 files in");
    expect(text).toContain("The plugin no longer has them");
    expect(text).not.toContain("replaced");
  });

  it("names the removed files when a refresh both replaced and removed", async () => {
    const out = capture();
    try {
      await settleKeptHostPluginViewFiles({}, {
        interactive: false,
        confirm: async () => false,
        take: () => [],
        takeReplaced: () => [{
          hostView,
          backupId: "01TEST",
          files: ["skills/s47/SKILL.md", "skills/s47/b.md"],
          notWrittenByHarnessTap: [],
          removed: ["skills/s47/b.md"],
        }],
        replace: () => ({ paths: [] }),
      });
    } finally {
      out.restore();
    }
    const text = out.lines.join("\n");
    expect(text).toContain("Backed up and replaced or removed 2 files in");
    expect(text).toContain("Removed because the plugin no longer has them: skills/s47/b.md");
  });
});
