import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import {
  materializeFiles,
  removeGlobalMaterializedFiles,
  writeFiles,
} from "../../src/services/applier.ts";
import { hashOnDiskFile, restoreSafeRemovalBackup } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// A user replaced a file HarnessTap wrote with a link to a file outside their
// home. The link is theirs: it is kept and never followed, and nothing aborts.
const SKILL = ".claude/skills/s/b.md";

let ctx: TestContext;
let outside: string;
let precious: string;
let warn: ReturnType<typeof spyOn>;
beforeEach(async () => {
  ctx = await createInitializedTestContext("user-link-outside-");
  outside = createTempDir("user-link-outside-target");
  precious = join(outside, "precious.md");
  writeTextFile(precious, "precious\n");
  warn = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  cleanupDir(outside);
  await ctx.cleanup();
});

function full(path: string): string {
  return join(ctx.homeDir, path);
}

/** HarnessTap wrote `path`, then the user put a link to `precious` there. */
function writtenThenLinked(path: string): void {
  writeTextFile(full(path), "b v1\n");
  const resource = createResource({ type: "skill", name: "s", description: "", content: "", metadata: {}, source: "manual" });
  recordResourceMaterialization({
    resource_id: resource.id,
    scope: "global",
    root_path: ctx.homeDir,
    platform_id: "claude-code",
    path,
    action: "delete-file",
    ownership_key: "skill:s",
    generated_hash: hashOnDiskFile(full(path)) ?? "",
  });
  rmSync(full(path));
  symlinkSync(precious, full(path));
}

function linkIntact(path: string): void {
  expect(lstatSync(full(path)).isSymbolicLink()).toBe(true);
  expect(readlinkSync(full(path))).toBe(precious);
  expect(readFileSync(precious, "utf8")).toBe("precious\n");
}

describe("a user's link to a file outside the home", () => {
  it("is kept by a removal, and --force-remove removes the link itself with a backup", () => {
    writtenThenLinked(SKILL);

    const kept = removeGlobalMaterializedFiles(ctx.homeDir, [SKILL]);
    expect(kept.removed).toEqual([]);
    expect(kept.skipped.map((skip) => [skip.path, skip.reason])).toEqual([[SKILL, "modified"]]);
    linkIntact(SKILL);

    const forced = removeGlobalMaterializedFiles(ctx.homeDir, [SKILL], { forceRemove: true });
    expect(forced.removed).toEqual([SKILL]);
    expect(lstatSync(full(SKILL), { throwIfNoEntry: false })).toBeUndefined();
    expect(readFileSync(precious, "utf8")).toBe("precious\n");

    restoreSafeRemovalBackup({ applyId: forced.applyId, rootPath: ctx.homeDir });
    linkIntact(SKILL);
  });

  it("is never written through by an apply, and the apply goes on", async () => {
    writtenThenLinked(SKILL);
    const result = await materializeFiles(
      [{ path: SKILL, content: "b v2\n" }, { path: ".claude/skills/s/SKILL.md", content: "v2\n" }],
      ctx.homeDir,
      { conflictPolicy: "replace" },
    );
    expect(result.skippedFiles).toContain(SKILL);
    expect(result.writtenFiles).toEqual([".claude/skills/s/SKILL.md"]);
    linkIntact(SKILL);

    writeFiles([{ path: SKILL, content: "b v3\n" }], ctx.homeDir);
    linkIntact(SKILL);
    expect(warn.mock.calls.flat().join("\n")).toContain(`Kept ${SKILL}`);
  });

  it("still refuses a folder that leads out of the home", () => {
    mkdirSync(join(outside, "dir"));
    mkdirSync(full(".claude/skills"), { recursive: true });
    symlinkSync(join(outside, "dir"), full(".claude/skills/linked"));
    expect(() => writeFiles([{ path: ".claude/skills/linked/x.md", content: "x\n" }], ctx.homeDir))
      .toThrow("outside root via symlink");
    expect(existsSync(join(outside, "dir/x.md"))).toBe(false);
  });

  it("keeps a file under a folder that leads out of the home instead of failing the removal", () => {
    mkdirSync(join(outside, "dir"));
    writeTextFile(join(outside, "dir/x.md"), "x\n");
    writeTextFile(full(".claude/skills/s/SKILL.md"), "s\n");
    symlinkSync(join(outside, "dir"), full(".claude/skills/linked"));
    const result = removeGlobalMaterializedFiles(
      ctx.homeDir,
      [".claude/skills/linked/x.md", ".claude/skills/s/SKILL.md"],
      { forceRemove: true },
    );
    expect(result.removed).toEqual([".claude/skills/s/SKILL.md"]);
    expect(result.skipped.map((skip) => skip.path)).toEqual([".claude/skills/linked/x.md"]);
    expect(readFileSync(join(outside, "dir/x.md"), "utf8")).toBe("x\n");
  });
});
