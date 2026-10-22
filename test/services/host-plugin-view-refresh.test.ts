import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settleKeptHostPluginViewFiles } from "../../src/cli/handlers/host-plugin-view-kept.ts";
import { createResource } from "../../src/models/resource.ts";
import { recordResourceMaterialization } from "../../src/models/resource-materialization.ts";
import {
  type KeptHostPluginViewFiles,
  mirrorHostPluginView,
  replaceKeptHostPluginViewFiles,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin.ts";
import { hostPluginViewsPath } from "../../src/services/package-cache/host-plugin-views.ts";
import { applyTrashRoot, executeSafeFileRemovals, hashOnDiskFile } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

// Refreshing ~/.claude/plugins/cache/<mkt>/<name>/<ver> must never delete a
// file HarnessTap did not write: only its own unchanged files are replaced or
// removed, each one backed up first, and only empty folders go.
const VIEW = ".claude/plugins/cache/mkta/dup/1.0.0";

let ctx: TestContext;
let canonicalDirs: string[] = [];
beforeEach(async () => {
  ctx = await createInitializedTestContext("host-view-refresh-");
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  canonicalDirs = [];
});
afterEach(async () => {
  setHostPluginViewForceReplace(false);
  takeKeptHostPluginViewFiles();
  for (const dir of canonicalDirs) cleanupDir(dir);
  await ctx.cleanup();
});

function packageTree(files: Record<string, string>): string {
  const dir = createTempDir("host-view-pkg");
  canonicalDirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeTextFile(join(dir, path), content);
  return dir;
}

function mirror(canonicalDir: string): void {
  mirrorHostPluginView({
    homeRoot: ctx.homeDir,
    marketplace: "mkta",
    pluginName: "dup",
    version: "1.0.0",
    canonicalDir,
  });
}

function view(path = ""): string {
  return join(ctx.homeDir, VIEW, path);
}

function trashFiles(): Map<string, string> {
  const found = new Map<string, string>();
  const root = applyTrashRoot();
  const walk = (dir: string, prefix: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else found.set(rel.split("/").slice(1).join("/"), readFileSync(full, "utf8"));
    }
  };
  walk(root, "");
  return found;
}

const MANIFEST = { ".claude-plugin/plugin.json": '{"name":"dup","version":"1.0.0"}\n' };

describe("refreshing a host plugin folder HarnessTap created", () => {
  it("replaces and removes only its own unchanged files, backs each one up, and keeps the rest", () => {
    mirror(
      packageTree({
        ...MANIFEST,
        "skills/old/SKILL.md": "old skill\n",
        "skills/keep/SKILL.md": "keep v1\n",
        "skills/edited/SKILL.md": "edited v1\n",
      }),
    );
    writeFileSync(view("skills/edited/SKILL.md"), "my edit\n");
    writeTextFile(view("notes/mine.md"), "my notes\n");

    mirror(
      packageTree({
        ...MANIFEST,
        "skills/keep/SKILL.md": "keep v2\n",
        "skills/edited/SKILL.md": "edited v2\n",
        "skills/new/SKILL.md": "new skill\n",
      }),
    );

    expect(readFileSync(view("skills/keep/SKILL.md"), "utf8")).toBe("keep v2\n");
    expect(readFileSync(view("skills/new/SKILL.md"), "utf8")).toBe("new skill\n");
    expect(existsSync(view("skills/old"))).toBe(false);
    expect(readFileSync(view("skills/edited/SKILL.md"), "utf8")).toBe("my edit\n");
    expect(readFileSync(view("notes/mine.md"), "utf8")).toBe("my notes\n");

    const trash = trashFiles();
    expect(trash.get(`${VIEW}/skills/old/SKILL.md`)).toBe("old skill\n");
    expect(trash.get(`${VIEW}/skills/keep/SKILL.md`)).toBe("keep v1\n");

    const kept = takeKeptHostPluginViewFiles();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.files).toEqual([
      { path: "notes/mine.md", reason: "unmanaged" },
      { path: "skills/edited/SKILL.md", reason: "modified" },
    ]);
  });

  it("replaces kept files only after the user agrees, backing them up first", () => {
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" }));
    writeFileSync(view("skills/a/SKILL.md"), "my a\n");
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v2\n" }));
    const [entry] = takeKeptHostPluginViewFiles();
    expect(entry?.files).toEqual([{ path: "skills/a/SKILL.md", reason: "modified" }]);
    if (!entry) throw new Error("expected kept files");

    replaceKeptHostPluginViewFiles(entry);
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v2\n");
    expect(trashFiles().get(`${VIEW}/skills/a/SKILL.md`)).toBe("my a\n");

    // Now HarnessTap's again: the next refresh replaces it without asking.
    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v3\n" }));
    expect(readFileSync(view("skills/a/SKILL.md"), "utf8")).toBe("a v3\n");
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
  });

  it("treats files an apply adopted under a version 1 record as HarnessTap's", () => {
    const tree = packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a v1\n" });
    mirror(tree);
    // A record written before per-file hashes: just the folder.
    writeFileSync(hostPluginViewsPath(), `${JSON.stringify([view().replace(/\/$/, "")])}\n`);
    const pin = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
    recordResourceMaterialization({
      resource_id: pin.id,
      scope: "global",
      root_path: ctx.homeDir,
      platform_id: "claude-code",
      path: `${VIEW}/skills/a/SKILL.md`,
      action: "delete-file",
      ownership_key: "plugin:dup@mkta",
      generated_hash: hashOnDiskFile(view("skills/a/SKILL.md")) ?? "",
    });

    mirror(packageTree({ ...MANIFEST, "skills/b/SKILL.md": "b\n" }));
    expect(existsSync(view("skills/a"))).toBe(false);
    expect(trashFiles().get(`${VIEW}/skills/a/SKILL.md`)).toBe("a v1\n");
    // The manifest file was never tracked under the old record, and it still
    // matches the package, so it stays as it is.
    expect(readFileSync(view(".claude-plugin/plugin.json"), "utf8")).toBe(MANIFEST[".claude-plugin/plugin.json"]);
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
  });
});

describe("a host plugin folder ht revert restored", () => {
  it("is HarnessTap's again through the manifest, and goes once its files are removed", () => {
    // A revert restores the files and their manifest rows, but not the
    // folder record, so the folder is no longer marked as created.
    writeTextFile(view(".claude-plugin/plugin.json"), MANIFEST[".claude-plugin/plugin.json"]);
    writeTextFile(view("skills/a/SKILL.md"), "a\n");
    const pin = createResource({ type: "plugin", name: "dup", description: "", content: "{}", metadata: {}, source: "manual" });
    for (const path of [".claude-plugin/plugin.json", "skills/a/SKILL.md"]) {
      recordResourceMaterialization({
        resource_id: pin.id,
        scope: "global",
        root_path: ctx.homeDir,
        platform_id: "claude-code",
        path: `${VIEW}/${path}`,
        action: "delete-file",
        ownership_key: "plugin:dup@mkta",
        generated_hash: hashOnDiskFile(view(path)) ?? "",
      });
    }

    mirror(packageTree({ ...MANIFEST, "skills/a/SKILL.md": "a\n" }));
    expect(takeKeptHostPluginViewFiles()).toEqual([]);

    const removal = executeSafeFileRemovals(ctx.homeDir, [
      `${VIEW}/.claude-plugin/plugin.json`,
      `${VIEW}/skills/a/SKILL.md`,
    ]);
    expect(removal.skipped).toEqual([]);
    expect(existsSync(join(ctx.homeDir, ".claude/plugins/cache/mkta"))).toBe(false);
    const records = JSON.parse(readFileSync(hostPluginViewsPath(), "utf8")) as { views: Record<string, unknown> };
    expect(records.views).toEqual({});
  });
});

describe("refreshing a host plugin folder HarnessTap did not create", () => {
  it("adds the package files and deletes nothing that was there", () => {
    writeTextFile(view(".claude-plugin/plugin.json"), MANIFEST[".claude-plugin/plugin.json"]);
    writeTextFile(view("skills/claude/SKILL.md"), "from claude\n");
    writeTextFile(view("node_modules/x/index.js"), "x\n");

    mirror(packageTree({ ...MANIFEST, "skills/claude/SKILL.md": "package\n", "skills/b/SKILL.md": "b\n" }));

    expect(readFileSync(view("skills/claude/SKILL.md"), "utf8")).toBe("from claude\n");
    expect(readFileSync(view("node_modules/x/index.js"), "utf8")).toBe("x\n");
    expect(readFileSync(view("skills/b/SKILL.md"), "utf8")).toBe("b\n");
    expect(trashFiles().size).toBe(0);
    const [entry] = takeKeptHostPluginViewFiles();
    expect(entry?.files.map((file) => file.path)).toEqual([
      "node_modules/x/index.js",
      "skills/claude/SKILL.md",
    ]);
  });

  it("reports a folder refreshed twice in one command once", () => {
    writeTextFile(view("skills/claude/SKILL.md"), "from claude\n");
    const tree = packageTree({ ...MANIFEST, "skills/claude/SKILL.md": "package\n" });
    mirror(tree);
    mirror(tree);
    expect(takeKeptHostPluginViewFiles()).toHaveLength(1);
  });

  it("replaces them with --force-remove, backing each one up", () => {
    writeTextFile(view("skills/claude/SKILL.md"), "from claude\n");
    setHostPluginViewForceReplace(true);

    mirror(packageTree({ ...MANIFEST, "skills/claude/SKILL.md": "package\n" }));

    expect(readFileSync(view("skills/claude/SKILL.md"), "utf8")).toBe("package\n");
    expect(trashFiles().get(`${VIEW}/skills/claude/SKILL.md`)).toBe("from claude\n");
    expect(takeKeptHostPluginViewFiles()).toEqual([]);
  });
});

describe("settleKeptHostPluginViewFiles", () => {
  const entry: KeptHostPluginViewFiles = {
    homeRoot: "/home/u",
    hostView: "/home/u/.claude/plugins/cache/mkta/dup/1.0.0",
    canonicalDir: "/pkg",
    files: [{ path: "skills/a/SKILL.md", reason: "modified" }],
  };

  it("asks in a terminal and replaces on yes", async () => {
    const replaced: KeptHostPluginViewFiles[] = [];
    const asked: string[] = [];
    await settleKeptHostPluginViewFiles({}, {
      interactive: true,
      confirm: async ({ message }) => {
        asked.push(message);
        return true;
      },
      take: () => [entry],
      replace: (next) => {
        replaced.push(next);
        return [];
      },
    });
    expect(asked).toHaveLength(1);
    expect(replaced).toEqual([entry]);
  });

  it("keeps the files and names --force-remove when it cannot ask", async () => {
    const replaced: KeptHostPluginViewFiles[] = [];
    const errors: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      await settleKeptHostPluginViewFiles({}, {
        interactive: false,
        confirm: async () => true,
        take: () => [entry],
        replace: (next) => {
          replaced.push(next);
          return [];
        },
      });
    } finally {
      console.error = original;
    }
    expect(replaced).toEqual([]);
    expect(errors.join("\n")).toContain("Kept 1 file in");
    expect(errors.join("\n")).toContain("--force-remove");
    expect(errors.join("\n")).toContain("skills/a/SKILL.md (changed since HarnessTap wrote it)");
  });
});

