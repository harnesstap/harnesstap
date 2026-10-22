import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";
import { resolveHomeRoot } from "../../src/utils/home-root.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

// A profile can lay out AGENTS.md as a link to CLAUDE.md and a skills folder as
// a link to a shared folder. Reverting to that profile must put the links back,
// not a copy of the file they pointed to, and not drop the folder link.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-links-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function layOutLinks(home: string): void {
  writeTextFile(join(home, "CLAUDE.md"), "# rules\n");
  symlinkSync("CLAUDE.md", join(home, "AGENTS.md"));
  writeTextFile(join(home, ".agents/skills/s/SKILL.md"), "# s\n");
  mkdirSync(join(home, ".opencode"), { recursive: true });
  symlinkSync("../.agents/skills", join(home, ".opencode/skills"));
}

function snapshotOf(home: string): string {
  const state = captureManagedSnapshotState({
    rootPath: home,
    generated: [{ platformId: "codex", files: [{ path: "AGENTS.md", content: "# rules\n" }] }],
    extraPaths: ["CLAUDE.md", ".opencode/skills"],
  });
  return createGlobalApplySnapshot({ profile_name: "links", plugin_ids: [], state }).id;
}

function revert(id: string) {
  const plan = resolveRevertPlan(id);
  if ("error" in plan) throw new Error(plan.error);
  return executeRevert(plan);
}

describe("ht revert with links in the snapshot", () => {
  it("captures links as links, not as the bytes they point to or as absent", () => {
    const home = resolveHomeRoot();
    layOutLinks(home);
    const state = captureManagedSnapshotState({
      rootPath: home,
      generated: [{ platformId: "codex", files: [{ path: "AGENTS.md", content: "# rules\n" }] }],
      extraPaths: [".opencode/skills"],
    });
    expect(state.disk_links).toEqual({ "AGENTS.md": "CLAUDE.md", ".opencode/skills": "../.agents/skills" });
    expect(state.disk_files?.["AGENTS.md"]).toBeUndefined();
    expect(state.absent_paths ?? []).not.toContain(".opencode/skills");
  });

  it("puts removed links back as links", () => {
    const home = resolveHomeRoot();
    layOutLinks(home);
    const id = snapshotOf(home);
    unlinkSync(join(home, "AGENTS.md"));
    unlinkSync(join(home, ".opencode/skills"));
    rmSync(join(home, ".opencode"), { recursive: true });

    const result = revert(id);

    expect(result.skipped).toEqual([]);
    expect(lstatSync(join(home, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, "AGENTS.md"))).toBe("CLAUDE.md");
    expect(readlinkSync(join(home, ".opencode/skills"))).toBe("../.agents/skills");
    expect(readFileSync(join(home, ".opencode/skills/s/SKILL.md"), "utf8")).toBe("# s\n");
    expect(result.restored).toEqual(expect.arrayContaining(["AGENTS.md", ".opencode/skills"]));
  });

  it("leaves what the user put at a link's path and says so", () => {
    const home = resolveHomeRoot();
    layOutLinks(home);
    const id = snapshotOf(home);
    unlinkSync(join(home, "AGENTS.md"));
    writeTextFile(join(home, "AGENTS.md"), "# mine\n");
    unlinkSync(join(home, ".opencode/skills"));
    writeTextFile(join(home, ".opencode/skills/mine/SKILL.md"), "# mine\n");

    const result = revert(id);

    expect(readFileSync(join(home, "AGENTS.md"), "utf8")).toBe("# mine\n");
    expect(readFileSync(join(home, ".opencode/skills/mine/SKILL.md"), "utf8")).toBe("# mine\n");
    expect(result.skipped.map((row) => row.path).sort()).toEqual([".opencode/skills", "AGENTS.md"]);
  });

  it("does not report a dry run as writing anything", () => {
    const home = resolveHomeRoot();
    layOutLinks(home);
    const id = snapshotOf(home);
    unlinkSync(join(home, "AGENTS.md"));
    const plan = resolveRevertPlan(id);
    if ("error" in plan) throw new Error(plan.error);
    const result = executeRevert(plan, { dryRun: true });
    expect(result.restored).toContain("AGENTS.md");
    expect(() => lstatSync(join(home, "AGENTS.md"))).toThrow();
  });
});
