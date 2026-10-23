import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reconcileMarketplacePluginTrees } from "../../src/services/claude-marketplace-plugin-trees.ts";
import {
  emitClaudeMarketplaceRegistrations,
  marketplacePluginSource,
} from "../../src/services/claude-marketplace-registration.ts";
import type { SerializedFile } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("claude-mkt-trees-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const MP = "acme";
const mpDir = () => join(ctx.homeDir, ".claude/plugins/harnesstap-marketplaces", MP);
const view = (name: string, version = "1.0.0") =>
  join(ctx.homeDir, ".claude/plugins/cache", MP, name, version);
const tree = (name: string) => join(mpDir(), "plugins", name);

function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function listPlugin(name: string, version = "1.0.0"): void {
  const path = join(mpDir(), ".claude-plugin/marketplace.json");
  let plugins: unknown[] = [];
  try {
    plugins = (JSON.parse(readFileSync(path, "utf8")) as { plugins: unknown[] }).plugins;
  } catch {
    // First entry.
  }
  plugins.push({ name, version, source: marketplacePluginSource(name) });
  put(path, JSON.stringify({ name: MP, plugins }));
}

describe("marketplace manifest sources", () => {
  it("writes ./plugins/<name> sources that stay inside the marketplace folder", () => {
    const files: SerializedFile[] = [];
    const official = "claude-plugins-official";
    emitClaudeMarketplaceRegistrations(files, ctx.homeDir, new Map([
      [official, [{ name: "tool", version: "1.0.0", relativeRoot: `.claude/plugins/cache/${official}/tool/1.0.0` }]],
    ]));
    const manifest = files.find((file) => file.path.endsWith("marketplace.json"));
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest?.content ?? "{}") as { plugins: { source: string }[] };
    expect(parsed.plugins[0]?.source).toBe("./plugins/tool");
    expect(JSON.stringify(parsed)).not.toContain("..");
  });
});

describe("reconcileMarketplacePluginTrees", () => {
  it("builds the tree of a listed plugin from its cache folder, links included", () => {
    put(join(view("tool"), "skills/a/SKILL.md"), "skill");
    put(join(view("tool"), ".claude-plugin/plugin.json"), "{}");
    symlinkSync("skills/a/SKILL.md", join(view("tool"), "LINK.md"));
    listPlugin("tool");

    reconcileMarketplacePluginTrees(ctx.homeDir);

    expect(readFileSync(join(tree("tool"), "skills/a/SKILL.md"), "utf8")).toBe("skill");
    expect(existsSync(join(tree("tool"), ".claude-plugin/plugin.json"))).toBe(true);
    expect(lstatSync(join(tree("tool"), "LINK.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(tree("tool"), "LINK.md"))).toBe("skills/a/SKILL.md");
  });

  it("skips a listed plugin whose cache folder is gone", () => {
    listPlugin("ghost");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(existsSync(tree("ghost"))).toBe(false);
  });

  it("is idempotent and follows an updated cache folder", () => {
    put(join(view("tool"), "a.md"), "one");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(tree("tool"), "a.md"), "utf8")).toBe("one");

    // A refresh that replaces the file (new inode) and adds one.
    writeFileSync(join(view("tool"), "a.md.new"), "two");
    put(join(view("tool"), "b.md"), "b");
    renameSync(join(view("tool"), "a.md.new"), join(view("tool"), "a.md"));
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(tree("tool"), "a.md"), "utf8")).toBe("two");
    expect(readFileSync(join(tree("tool"), "b.md"), "utf8")).toBe("b");
  });

  it("removes the tree when the plugin leaves the cache and keeps the marketplace folder's other files", () => {
    put(join(view("tool"), "a.md"), "one");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    rmSync(view("tool"), { recursive: true });
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(existsSync(tree("tool"))).toBe(false);
    expect(existsSync(join(mpDir(), ".claude-plugin/marketplace.json"))).toBe(true);
  });

  it("removes the emptied marketplace folder when the manifest is gone too", () => {
    put(join(view("tool"), "a.md"), "one");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    rmSync(join(mpDir(), ".claude-plugin"), { recursive: true });
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(existsSync(mpDir())).toBe(false);
  });

  it("keeps a file you changed or added, and the folder around it", () => {
    put(join(view("tool"), "a.md"), "one");
    put(join(view("tool"), "b.md"), "two");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    // Break the hard link, then edit: the file is yours now.
    rmSync(join(tree("tool"), "a.md"));
    writeFileSync(join(tree("tool"), "a.md"), "mine");
    put(join(tree("tool"), "notes.txt"), "my notes");
    rmSync(view("tool"), { recursive: true });

    reconcileMarketplacePluginTrees(ctx.homeDir);

    expect(readFileSync(join(tree("tool"), "a.md"), "utf8")).toBe("mine");
    expect(readFileSync(join(tree("tool"), "notes.txt"), "utf8")).toBe("my notes");
    expect(existsSync(join(tree("tool"), "b.md"))).toBe(false);
  });

  it("does not overwrite a file you changed when the cache folder updates", () => {
    put(join(view("tool"), "a.md"), "one");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    rmSync(join(tree("tool"), "a.md"));
    writeFileSync(join(tree("tool"), "a.md"), "mine");
    rmSync(join(view("tool"), "a.md"));
    writeFileSync(join(view("tool"), "a.md"), "newer");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(tree("tool"), "a.md"), "utf8")).toBe("mine");
  });

  it("never touches a plugins/ folder it did not record", () => {
    put(join(mpDir(), "plugins/other/keep.md"), "user");
    put(join(view("tool"), "a.md"), "one");
    listPlugin("tool");
    reconcileMarketplacePluginTrees(ctx.homeDir);
    rmSync(view("tool"), { recursive: true });
    reconcileMarketplacePluginTrees(ctx.homeDir);
    expect(readFileSync(join(mpDir(), "plugins/other/keep.md"), "utf8")).toBe("user");
  });
});
