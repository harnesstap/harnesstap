import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { printApplySuccess } from "../../src/cli/print-apply-summary.ts";
import {
  recordKeptHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin-view-policy.ts";

const homeRoot = "/home/u";
const hostView = `${homeRoot}/.claude/plugins/cache/mkta/p47/1.0.0`;
const folder = ".claude/plugins/cache/mkta/p47/1.0.0";

afterEach(() => {
  takeKeptHostPluginViewFiles();
});

function summary(alreadyReported: boolean): string {
  recordKeptHostPluginViewFiles({
    homeRoot,
    hostView,
    canonicalDir: "/canonical/p47",
    alreadyReported,
    files: [
      { path: "skills/s47/a.md", reason: "modified" },
      { path: "skills/s47/c.md", reason: "unmanaged" },
      { path: "user-notes.md", reason: "unmanaged" },
    ],
  });
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message?: unknown) => {
    lines.push(String(message ?? ""));
  });
  try {
    printApplySuccess({
      name: "pr",
      harnessCount: 1,
      wrote: 0,
      removed: 0,
      kept: [{ path: `${folder}/skills/s47/a.md`, reason: "modified" }],
      unchanged: 6,
    });
  } finally {
    log.mockRestore();
  }
  return lines.join("\n");
}

describe("apply summary on a repeated apply", () => {
  it("counts the kept plugin folder files an earlier apply already reported", () => {
    const text = summary(true);
    expect(text).toContain("kept 3");
    expect(text).toContain("2 more kept files in a plugin folder were listed by an earlier apply");
    expect(text).not.toContain("user-notes.md");
    expect(text.split("skills/s47/a.md").length - 1).toBe(1);
  });

  it("adds no pointer when the notice is shown this time", () => {
    const text = summary(false);
    expect(text).toContain("kept 3");
    expect(text).not.toContain("earlier apply");
  });
});
