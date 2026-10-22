import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  mirrorHostPluginView,
  setHostPluginViewForceReplace,
  takeBlockedHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { hostPluginViewChangeCounts } from "../../src/services/package-cache/host-plugin-view-policy.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// The apply summary counts every plugin file a refresh writes: the ones it
// replaced (with their backup) and the new ones, each once.
const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"cnt","version":"1.0.0"}\n' };

let ctx: TestContext;
let dirs: string[] = [];
function reset(): void {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  takeReplacedHostPluginViewFiles();
  takeBlockedHostPluginViewFiles();
}
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-added-");
  reset();
  dirs = [];
});
afterEach(async () => {
  reset();
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function mirror(files: Record<string, string>): void {
  const dir = createTempDir("host-view-added-pkg");
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  mirrorHostPluginView({ homeRoot: ctx.homeDir, marketplace: "mkc", pluginName: "cnt", version: "1.0.0", canonicalDir: dir });
}

describe("plugin folder refresh counts", () => {
  it("counts a new plugin file as written, next to a replaced and a removed one", () => {
    mirror({ ...MANIFEST, "skills/s/SKILL.md": "v1\n", "skills/s/b.md": "b\n" });
    takeReplacedHostPluginViewFiles();

    mirror({ ...MANIFEST, "skills/s/SKILL.md": "v2\n", "skills/s/d.md": "d\n" });

    expect(hostPluginViewChangeCounts()).toEqual({ replaced: 1, removed: 1, added: 1 });
  });

  it("counts every file of a new plugin folder, as a version bump creates", () => {
    mirror({ ...MANIFEST, "skills/s/SKILL.md": "v1\n", "skills/s/b.md": "b\n" });
    expect(hostPluginViewChangeCounts()).toEqual({ replaced: 0, removed: 0, added: 3 });
  });

  it("does not count files again when nothing changed", () => {
    const files = { ...MANIFEST, "skills/s/SKILL.md": "v1\n" };
    mirror(files);
    takeReplacedHostPluginViewFiles();
    mirror(files);
    expect(hostPluginViewChangeCounts()).toEqual({ replaced: 0, removed: 0, added: 0 });
  });
});
