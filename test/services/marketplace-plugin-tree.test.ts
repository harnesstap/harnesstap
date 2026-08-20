import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMarketplace } from "../../src/services/marketplace-registry.js";
import { refreshMarketplaceCatalog } from "../../src/services/marketplace-catalog.js";
import { previewMarketplacePlugin } from "../../src/services/marketplace-plugin-tree.js";

const HELLO_CONTENT = "hello from marketplace\n";

function initMarketplaceRepoWithPluginFile(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-tree-repo-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins", "demo-plugin", "skills"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "tree-market",
      plugins: [{ name: "demo-plugin", version: "1.0.0", description: "Demo" }],
    }),
  );
  writeFileSync(join(repo, "plugins", "demo-plugin", "skills", "hello.md"), HELLO_CONTENT);
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    { cwd: repo, stdio: "ignore" },
  );
  return repo;
}

function writeStoredCatalog(
  cacheDir: string,
  pluginName: string,
  marketplaceName = "local-market",
): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, "catalog.json"),
    `${JSON.stringify({
      marketplaceName,
      marketplaceEntryName: marketplaceName,
      plugins: [{ name: pluginName, ref: `${pluginName}@${marketplaceName}` }],
      refreshedAt: "2026-01-01T00:00:00.000Z",
    }, null, 2)}\n`,
  );
}

describe("previewMarketplacePlugin", () => {
  it("lists files under plugins/<name> from a refreshed marketplace cache", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const repo = initMarketplaceRepoWithPluginFile();
    addMarketplace(home, {
      name: "tree-market",
      url: repo,
      platforms: ["claude-code"],
    });
    const refreshed = refreshMarketplaceCatalog(home, {
      name: "tree-market",
      force: true,
    });
    expect(refreshed.ok).toBe(true);

    const result = previewMarketplacePlugin(home, {
      marketplace: "tree-market",
      plugin: "demo-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [{ path: "skills/hello.md", kind: "file" }],
    });
  });

  it("returns utf-8 file content for a relative path", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const repo = initMarketplaceRepoWithPluginFile();
    addMarketplace(home, {
      name: "tree-market",
      url: repo,
      platforms: ["claude-code"],
    });
    refreshMarketplaceCatalog(home, { name: "tree-market", force: true });

    const result = previewMarketplacePlugin(home, {
      marketplace: "tree-market",
      plugin: "demo-plugin",
      path: "skills/hello.md",
    });
    expect(result).toEqual({
      status: "ok",
      path: "skills/hello.md",
      content: HELLO_CONTENT,
    });
  });

  it("resolves a plugin directory at the cache root", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "rooted-plugin");
    mkdirSync(join(cacheDir, "rooted-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "rooted-plugin", "README.md"), "rooted\n");

    const result = previewMarketplacePlugin(home, {
      marketplace: "local-market",
      plugin: "rooted-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [{ path: "README.md", kind: "file" }],
    });
  });

  it("resolves a plugin directory one level below the cache root", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "nested-plugin");
    mkdirSync(join(cacheDir, "vendor", "nested-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "vendor", "nested-plugin", "note.txt"), "nested\n");

    const result = previewMarketplacePlugin(home, {
      marketplace: "local-market",
      plugin: "nested-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [{ path: "note.txt", kind: "file" }],
    });
  });

  it("prefers plugins/<name> over a same-named folder at the cache root", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin"), { recursive: true });
    mkdirSync(join(cacheDir, "demo-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "from-plugins.txt"), "win\n");
    writeFileSync(join(cacheDir, "demo-plugin", "from-root.txt"), "lose\n");

    const result = previewMarketplacePlugin(home, {
      marketplace: "local-market",
      plugin: "demo-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [{ path: "from-plugins.txt", kind: "file" }],
    });
  });

  it("skips .git directories when listing files", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin", ".git"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", ".git", "HEAD"), "ref\n");
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "keep.md"), "keep\n");

    const result = previewMarketplacePlugin(home, {
      marketplace: "local-market",
      plugin: "demo-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [{ path: "keep.md", kind: "file" }],
    });
  });

  it("sorts listed paths", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin", "z"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "b.txt"), "b\n");
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "a.txt"), "a\n");
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "z", "c.txt"), "c\n");

    const result = previewMarketplacePlugin(home, {
      marketplace: "local-market",
      plugin: "demo-plugin",
    });
    expect(result).toEqual({
      status: "ok",
      files: [
        { path: "a.txt", kind: "file" },
        { path: "b.txt", kind: "file" },
        { path: "z/c.txt", kind: "file" },
      ],
    });
  });

  it("rejects path traversal, absolute paths, and NUL", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "ok.md"), "ok\n");

    const cases = ["../catalog.json", "/etc/passwd", "skills/\0secret.md"];
    for (const path of cases) {
      const result = previewMarketplacePlugin(home, {
        marketplace: "local-market",
        plugin: "demo-plugin",
        path,
      });
      expect(result).toEqual({ status: "invalid_path" });
    }
  });

  it("returns not_found for a missing file", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "ok.md"), "ok\n");

    expect(
      previewMarketplacePlugin(home, {
        marketplace: "local-market",
        plugin: "demo-plugin",
        path: "skills/missing.md",
      }),
    ).toEqual({ status: "not_found" });
  });

  it("returns not_found when the plugin is not in the stored catalog", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");
    mkdirSync(join(cacheDir, "plugins", "demo-plugin"), { recursive: true });
    writeFileSync(join(cacheDir, "plugins", "demo-plugin", "ok.md"), "ok\n");

    expect(
      previewMarketplacePlugin(home, {
        marketplace: "local-market",
        plugin: "missing-plugin",
      }),
    ).toEqual({ status: "not_found" });
  });

  it("returns not_found when the plugin directory is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const cacheDir = join(home, "cache", "marketplaces", "local-market");
    writeStoredCatalog(cacheDir, "demo-plugin");

    expect(
      previewMarketplacePlugin(home, {
        marketplace: "local-market",
        plugin: "demo-plugin",
      }),
    ).toEqual({ status: "not_found" });
  });

  it("refreshes an empty catalog before looking up the plugin", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-tree-home-"));
    const repo = initMarketplaceRepoWithPluginFile();
    addMarketplace(home, {
      name: "tree-market",
      url: repo,
      platforms: ["claude-code"],
    });

    const result = previewMarketplacePlugin(home, {
      marketplace: "tree-market",
      plugin: "demo-plugin",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || !("files" in result)) return;
    expect(result.files).toEqual([{ path: "skills/hello.md", kind: "file" }]);
  });
});
