import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { harnesstapDirForHomeRoot } from "../../src/db/connection.ts";
import { hostPluginFolderChanges } from "../../src/services/global-profile-drift.ts";
import { diffHostPluginView, mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";
import { driftChangeIsKept } from "../../src/services/project-drift.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

// `profile status` compares the host plugin cache folder with the plugin's
// package, because the apply emits that folder from itself.
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-status-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const VIEW = ".claude/plugins/cache/mkta/p/1.0.0";

function canonical(): string {
  const dir = hostPluginPackageDir(harnesstapDirForHomeRoot(ctx.homeDir), "mkta", "p", "1.0.0");
  writeTextFile(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
  writeTextFile(join(dir, "skills/s/SKILL.md"), "plugin skill\n");
  writeTextFile(join(dir, "skills/s/ref.md"), "plugin ref\n");
  return dir;
}

describe("host plugin folder status", () => {
  it("finds nothing when the folder matches the plugin", () => {
    const dir = canonical();
    mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkta", pluginName: "p", version: "1.0.0", canonicalDir: dir });
    expect(diffHostPluginView({ homeRoot: ctx.homeDir, hostView: join(ctx.homeDir, VIEW), canonicalDir: dir })).toEqual([]);
  });

  it("reports the user's files in a folder that existed before HarnessTap as kept", () => {
    const dir = canonical();
    writeTextFile(join(ctx.homeDir, VIEW, "skills/s/SKILL.md"), "my skill\n");
    writeTextFile(join(ctx.homeDir, VIEW, "skills/s/own.md"), "mine\n");
    mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkta", pluginName: "p", version: "1.0.0", canonicalDir: dir });

    const changes = hostPluginFolderChanges(ctx.homeDir, [{ path: `${VIEW}/skills/s/SKILL.md` }], []);
    expect(changes).toEqual([
      { path: `${VIEW}/skills/s/own.md`, type: "modified", removal_group: "unmanaged" },
      { path: `${VIEW}/skills/s/SKILL.md`, type: "modified", removal_group: "unmanaged" },
    ]);
    expect(changes.every(driftChangeIsKept)).toBe(true);
  });

  it("reports files HarnessTap wrote that are missing or that changed since, as changed by Claude Code", () => {
    const dir = canonical();
    mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkta", pluginName: "p", version: "1.0.0", canonicalDir: dir });
    rmSync(join(ctx.homeDir, VIEW, "skills/s/ref.md"));
    writeTextFile(join(ctx.homeDir, VIEW, "skills/s/SKILL.md"), "edited\n");

    const changes = hostPluginFolderChanges(
      ctx.homeDir,
      [{ path: `${VIEW}/skills/s/SKILL.md` }, { path: `${VIEW}/.claude-plugin/plugin.json` }],
      [],
    );
    expect(changes).toEqual([
      { path: `${VIEW}/skills/s/ref.md`, type: "deleted" },
      { path: `${VIEW}/skills/s/SKILL.md`, type: "modified", removal_group: "owned_modified", changed_by: "claude-code" },
    ]);
    // A path the file comparison already reported is not repeated.
    expect(
      hostPluginFolderChanges(ctx.homeDir, [{ path: `${VIEW}/skills/s/SKILL.md` }], [
        { path: `${VIEW}/skills/s/ref.md`, type: "deleted" },
      ]),
    ).toHaveLength(1);
  });

  it("ignores folders with no HarnessTap copy of the plugin", () => {
    writeTextFile(join(ctx.homeDir, ".claude/plugins/cache/other/q/1.0.0/notes.md"), "mine\n");
    expect(
      hostPluginFolderChanges(ctx.homeDir, [{ path: ".claude/plugins/cache/other/q/1.0.0/notes.md" }], []),
    ).toEqual([]);
  });
});
