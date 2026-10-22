import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { harnesstapDirForHomeRoot } from "../../src/db/connection.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import { planMaterializationConflicts } from "../../src/services/applier.ts";
import { emitHostPluginTrees } from "../../src/services/host-plugin-serialize.ts";
import { mirrorHostPluginView } from "../../src/services/package-cache/host-plugin.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";
import { hashOnDiskFile } from "../../src/services/safe-file-removal.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

// After `ht plugin update` bumps a marketplace plugin, the next apply writes
// the new version's files into the new version's folder and points the host
// registry at it, so switching away later finds every file HarnessTap wrote.
const CACHE = ".claude/plugins/cache/mkta/bump";
const REGISTRY = ".claude/plugins/installed_plugins.json";

let ctx: TestContext;
let dirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-version-bump-");
  dirs = [];
});
afterEach(async () => {
  for (const dir of dirs) cleanupDir(dir);
  await ctx.cleanup();
});

function tree(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) writeTextFile(join(root, path), content);
  return root;
}

function pin(version: string): Resource {
  return makeResource({
    type: "plugin",
    name: "bump",
    namespace: "mkta",
    origin_kind: "marketplace_link",
    origin_ref: "bump@mkta",
    content: "{}",
    metadata: { source_kind: "marketplace", marketplace_name: "mkta", resolved_version: version },
  });
}

function registry(version: string): string {
  return `${JSON.stringify({
    version: 2,
    plugins: { "bump@mkta": [{ scope: "user", installPath: `cache/mkta/bump/${version}`, version }] },
  }, null, 2)}\n`;
}

describe("an apply after a plugin version bump", () => {
  it("copies the new version's files into the new version's folder", () => {
    const old = createTempDir("bump-old");
    dirs.push(old);
    mirrorHostPluginView({
      homeRoot: ctx.homeDir,
      marketplace: "mkta",
      pluginName: "bump",
      version: "1.0.0",
      canonicalDir: tree(old, {
        ".claude-plugin/plugin.json": '{"name":"bump","version":"1.0.0"}\n',
        "skills/s/a.md": "a v1\n",
      }),
    });
    writeTextFile(join(ctx.homeDir, REGISTRY), registry("1.0.0"));
    tree(hostPluginPackageDir(harnesstapDirForHomeRoot(ctx.homeDir), "mkta", "bump", "1.1.0"), {
      ".claude-plugin/plugin.json": '{"name":"bump","version":"1.1.0"}\n',
      "skills/s/a.md": "a v2\n",
      "skills/s/d.md": "d v2\n",
    });

    const emitted = emitHostPluginTrees([pin("1.1.0")], { layout: "claude-code", homeRoot: ctx.homeDir })
      .filter((file) => file.path.startsWith(`${CACHE}/`));
    const byPath = Object.fromEntries(emitted.map((file) => [file.path, String(file.content)]));

    expect(Object.keys(byPath).sort()).toEqual([
      `${CACHE}/1.1.0/.claude-plugin/plugin.json`,
      `${CACHE}/1.1.0/skills/s/a.md`,
      `${CACHE}/1.1.0/skills/s/d.md`,
    ]);
    expect(byPath[`${CACHE}/1.1.0/skills/s/a.md`]).toBe("a v2\n");
  });

  it("points the registry HarnessTap wrote at the new version without a conflict", async () => {
    writeTextFile(join(ctx.homeDir, REGISTRY), registry("1.0.0"));
    const resource = createResource({ type: "plugin", name: "bump", description: "", content: "{}", metadata: {}, source: "manual" });
    recordResourceMaterialization({
      resource_id: resource.id,
      scope: "global",
      root_path: ctx.homeDir,
      platform_id: "claude-code",
      path: REGISTRY,
      action: "edit-file",
      ownership_key: "plugin:bump@mkta",
      generated_hash: hashOnDiskFile(join(ctx.homeDir, REGISTRY)) ?? "",
    });

    const conflicts = await planMaterializationConflicts(
      [{ path: REGISTRY, content: registry("1.1.0") }],
      ctx.homeDir,
    );
    expect(conflicts).toEqual([]);
  });

  it("still asks before changing a registry HarnessTap did not write", async () => {
    writeTextFile(join(ctx.homeDir, REGISTRY), registry("1.0.0"));
    const conflicts = await planMaterializationConflicts(
      [{ path: REGISTRY, content: registry("1.1.0") }],
      ctx.homeDir,
    );
    expect(conflicts.map((conflict) => conflict.path)).toEqual([REGISTRY]);
  });
});
