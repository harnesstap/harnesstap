import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeBlockedHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { restoreHostPluginViewBackup } from "../../src/services/package-cache/host-plugin-view-backups.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// `--force-remove` backs up a file the user changed and puts the plugin's
// version back. The `ht revert <id>` it prints must put the user's version
// back, since what is there now is exactly what HarnessTap wrote.
const VIEW = ".claude/plugins/cache/mkr/rep/1.0.0";
const FILES = { ".claude-plugin/plugin.json": '{"name":"rep","version":"1.0.0"}\n', "skills/s/a.md": "a v1\n" };

let ctx: TestContext;
let dirs: string[] = [];
function reset(): void {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  takeBlockedHostPluginViewFiles();
}
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-revert-rep-");
  reset();
  dirs = [];
});
afterEach(async () => {
  reset();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function mirror(): void {
  const dir = createTempDir("host-view-revert-rep-pkg");
  dirs.push(dir);
  for (const [path, content] of Object.entries(FILES)) writeTextFile(join(dir, path), content);
  mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkr", pluginName: "rep", version: "1.0.0", canonicalDir: dir });
}
function view(path: string): string {
  return join(ctx.homeDir, VIEW, path);
}
function forceReplaceUserEdit(): string {
  mirror();
  writeFileSync(view("skills/s/a.md"), "a v1\nUSER EDIT\n");
  setHostPluginViewForceReplace(true);
  mirror();
  setHostPluginViewForceReplace(false);
  const [entry] = takeReplacedHostPluginViewFiles();
  expect(entry?.files).toEqual(["skills/s/a.md"]);
  expect(readFileSync(view("skills/s/a.md"), "utf8")).toBe("a v1\n");
  return entry?.backupId as string;
}

describe("ht revert of a --force-remove replacement", () => {
  it("puts the user's version back without --force-remove, in a dry run too", () => {
    const id = forceReplaceUserEdit();
    const dry = restoreHostPluginViewBackup(id, { dryRun: true });
    expect(dry?.restored).toEqual(["skills/s/a.md"]);
    expect(readFileSync(view("skills/s/a.md"), "utf8")).toBe("a v1\n");

    const real = restoreHostPluginViewBackup(id);
    expect(real?.skipped).toEqual([]);
    expect(real?.restored).toEqual(["skills/s/a.md"]);
    expect(real?.replacedBackupId).toBeDefined();
    expect(readFileSync(view("skills/s/a.md"), "utf8")).toBe("a v1\nUSER EDIT\n");
  });

  it("still needs --force-remove when the file changed again after the replacement", () => {
    const id = forceReplaceUserEdit();
    writeFileSync(view("skills/s/a.md"), "a v1\nSECOND EDIT\n");
    const real = restoreHostPluginViewBackup(id);
    expect(real?.restored).toEqual([]);
    expect(real?.skipped).toEqual([{ path: "skills/s/a.md", reason: "changed" }]);
    expect(readFileSync(view("skills/s/a.md"), "utf8")).toBe("a v1\nSECOND EDIT\n");
  });
});
