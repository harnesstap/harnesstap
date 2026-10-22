import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createGlobalApplySnapshot } from "../../src/models/global-apply-snapshot.ts";
import { executeSafeFileRemovals, restoreSafeRemovalBackup } from "../../src/services/safe-file-removal.ts";
import { captureManagedSnapshotState } from "../../src/services/snapshot-capture.ts";
import { executeRevert, resolveRevertPlan } from "../../src/services/snapshot-revert.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

// A revert puts back what an apply removed. A file or folder the user put
// where it has to go is never removed to make room: the path is skipped and
// named, the dry run says the same, and the rest comes back.
const FOLDER = ".claude/plugins/cache/mkt/p/1.0.0";
const OWNED = [`${FOLDER}/skills/s/SKILL.md`, `${FOLDER}/skills/s/a.md`, `${FOLDER}/plugin.json`];

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("revert-blocked-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function put(relative: string, content: string): void {
  const full = join(ctx.homeDir, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
}

/** The three files exist, an apply captures and removes them. Returns the snapshot id. */
function removeThem(): string {
  for (const path of OWNED) put(path, `bytes of ${path}\n`);
  const state = captureManagedSnapshotState({
    rootPath: ctx.homeDir,
    generated: [],
    removalBackedPaths: OWNED,
  });
  const snapshot = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state });
  executeSafeFileRemovals(ctx.homeDir, OWNED, {
    applyId: snapshot.id,
    snapshotId: snapshot.id,
    forceRemove: true,
  });
  rmSync(join(ctx.homeDir, FOLDER), { recursive: true, force: true });
  return snapshot.id;
}

function revert(id: string, options: { dryRun?: boolean; forceRemove?: boolean } = {}) {
  const plan = resolveRevertPlan(id);
  if ("error" in plan) throw new Error(plan.error);
  return executeRevert(plan, options);
}

describe("ht revert with something in the way", () => {
  it("skips the files under a user file where a folder goes, and restores the rest", () => {
    const id = removeThem();
    put(`${FOLDER}/skills/s`, "MINE\n");

    const result = revert(id);

    expect(readFileSync(join(ctx.homeDir, FOLDER, "skills/s"), "utf-8")).toBe("MINE\n");
    expect(readFileSync(join(ctx.homeDir, OWNED[2]!), "utf-8")).toBe(`bytes of ${OWNED[2]}\n`);
    expect(result.restored).toEqual([OWNED[2]!]);
    expect(result.skipped.map((skip) => skip.path).sort()).toEqual([OWNED[1]!, OWNED[0]!].sort());
    expect(result.skipped.every((skip) => skip.blockedBy === `${FOLDER}/skills/s`)).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`${FOLDER}/skills/s is in the way`);
    expect(result.warnings[0]).toContain(OWNED[0]!);
  });

  it("skips everything under a user file at the version folder", () => {
    const id = removeThem();
    put(FOLDER, "MINE\n");

    const result = revert(id);

    expect(readFileSync(join(ctx.homeDir, FOLDER), "utf-8")).toBe("MINE\n");
    expect(result.restored).toEqual([]);
    expect(result.skipped).toHaveLength(3);
  });

  it("skips a file whose path is a folder now", () => {
    const id = removeThem();
    put(`${OWNED[2]}/inner.txt`, "MINE\n");

    const result = revert(id);

    expect(statSync(join(ctx.homeDir, OWNED[2]!)).isDirectory()).toBe(true);
    expect(result.skipped.map((skip) => skip.path)).toEqual([OWNED[2]!]);
    expect(result.warnings[0]).toContain("a folder is at that path");
    expect(result.restored).toHaveLength(2);
  });

  it("shows the same skips in the dry run and changes nothing", () => {
    const id = removeThem();
    put(`${FOLDER}/skills/s`, "MINE\n");

    const dry = revert(id, { dryRun: true });
    expect(() => statSync(join(ctx.homeDir, OWNED[2]!))).toThrow();
    const real = revert(id);

    expect(dry.restored).toEqual(real.restored);
    expect(dry.skipped).toEqual(real.skipped);
    expect(dry.warnings).toEqual(real.warnings);
  });

  it("does not remove what is in the way with --force-remove", () => {
    const id = removeThem();
    put(`${FOLDER}/skills/s`, "MINE\n");

    const result = revert(id, { forceRemove: true });

    expect(readFileSync(join(ctx.homeDir, FOLDER, "skills/s"), "utf-8")).toBe("MINE\n");
    expect(result.skipped).toHaveLength(2);
  });

  it("skips a link whose folder is blocked", () => {
    put("CLAUDE.md", "# rules\n");
    mkdirSync(join(ctx.homeDir, "d"), { recursive: true });
    symlinkSync("../CLAUDE.md", join(ctx.homeDir, "d/AGENTS.md"));
    const state = captureManagedSnapshotState({ rootPath: ctx.homeDir, generated: [], extraPaths: ["d/AGENTS.md"] });
    const id = createGlobalApplySnapshot({ profile_name: "p", plugin_ids: [], state }).id;
    rmSync(join(ctx.homeDir, "d"), { recursive: true });
    put("d", "MINE\n");

    const result = revert(id);

    expect(readFileSync(join(ctx.homeDir, "d"), "utf-8")).toBe("MINE\n");
    expect(result.skipped.map((skip) => skip.path)).toEqual(["d/AGENTS.md"]);
    expect(result.warnings[0]).toContain("the link d/AGENTS.md");
  });

  it("restores a removal backup around a user file and never overwrites one", () => {
    for (const path of OWNED) put(path, `bytes of ${path}\n`);
    executeSafeFileRemovals(ctx.homeDir, OWNED, { applyId: "applyblocked1", forceRemove: true });
    rmSync(join(ctx.homeDir, FOLDER), { recursive: true, force: true });
    put(`${FOLDER}/skills/s`, "MINE\n");
    put(OWNED[2]!, "ALSO MINE\n");

    const skipped: string[] = [];
    const restored = restoreSafeRemovalBackup({
      applyId: "applyblocked1",
      rootPath: ctx.homeDir,
      onSkip: (skip) => skipped.push(skip.path),
    });

    expect(restored).toEqual([]);
    expect(skipped.sort()).toEqual([...OWNED].sort());
    expect(readFileSync(join(ctx.homeDir, FOLDER, "skills/s"), "utf-8")).toBe("MINE\n");
    expect(readFileSync(join(ctx.homeDir, OWNED[2]!), "utf-8")).toBe("ALSO MINE\n");
  });
});
