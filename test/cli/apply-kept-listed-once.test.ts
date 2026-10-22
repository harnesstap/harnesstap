import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { settleKeptHostPluginViewFiles } from "../../src/cli/handlers/host-plugin-view-kept.ts";
import { printApplySuccess } from "../../src/cli/print-apply-summary.ts";
import {
  recordKeptHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin-view-policy.ts";

const homeRoot = "/home/u";
const hostView = `${homeRoot}/.claude/plugins/cache/mkta/p47/1.0.0`;
const keptInFolder = ".claude/plugins/cache/mkta/p47/1.0.0/skills/s47/a.md";

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
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
});

async function applyOutput(): Promise<string> {
  recordKeptHostPluginViewFiles({
    homeRoot,
    hostView,
    canonicalDir: "/canonical/p47",
    files: [
      { path: "skills/s47/a.md", reason: "unmanaged" },
      { path: "skills/s47/b.md", reason: "modified" },
    ],
  });
  const out = capture();
  try {
    printApplySuccess({
      name: "pr",
      harnessCount: 1,
      wrote: 0,
      removed: 0,
      kept: [
        { path: keptInFolder, reason: "unmanaged" },
        { path: "CLAUDE.md", reason: "modified" },
      ],
      unchanged: 3,
    });
    await settleKeptHostPluginViewFiles({}, {
      interactive: false,
      confirm: async () => false,
      take: takeKeptHostPluginViewFiles,
      takeReplaced: takeReplacedHostPluginViewFiles,
      replace: () => ({ paths: [] }),
    });
  } finally {
    out.restore();
  }
  return out.lines.join("\n");
}

describe("apply summary lists each kept file once", () => {
  it("does not list a plugin folder file in both the apply list and the folder notice", async () => {
    const text = await applyOutput();
    expect(text.split(keptInFolder).length - 1).toBe(0);
    expect(text.split("skills/s47/a.md").length - 1).toBe(1);
    expect(text).toContain("CLAUDE.md");
  });

  it("counts every kept file once", async () => {
    const text = await applyOutput();
    expect(text).toContain("kept 3");
  });
});
