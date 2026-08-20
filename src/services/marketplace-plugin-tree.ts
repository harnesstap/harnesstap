import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  listCatalogPlugins,
  marketplaceCacheDir,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";

export type MarketplaceTreeFile = { path: string; kind: "file" };

export type MarketplacePluginTreeResult =
  | { status: "ok"; files: MarketplaceTreeFile[] }
  | { status: "ok"; path: string; content: string }
  | { status: "not_found" }
  | { status: "invalid_path" };

export function isInvalidPreviewPath(path: string): boolean {
  if (path.includes("\0")) return true;
  if (isAbsolute(path)) return true;
  return path.split(/[/\\]/).includes("..");
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function resolvePluginDirectory(cacheDir: string, pluginName: string): string | undefined {
  const underPlugins = join(cacheDir, "plugins", pluginName);
  if (isDirectory(underPlugins)) return underPlugins;

  const atRoot = join(cacheDir, pluginName);
  if (isDirectory(atRoot)) return atRoot;

  if (!isDirectory(cacheDir)) return undefined;

  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const nested = join(cacheDir, entry.name, pluginName);
    if (isDirectory(nested)) return nested;
  }
  return undefined;
}

function collectFiles(root: string, dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(relative(root, absolute).split(sep).join("/"));
  }
}

function ensureCatalogPlugins(harnesstapDir: string, marketplace: string) {
  let plugins = listCatalogPlugins(harnesstapDir, { name: marketplace });
  if (plugins.length === 0) {
    refreshMarketplaceCatalog(harnesstapDir, { name: marketplace, force: false });
    plugins = listCatalogPlugins(harnesstapDir, { name: marketplace });
  }
  return plugins;
}

export function previewMarketplacePlugin(
  harnesstapDir: string,
  input: { marketplace: string; plugin: string; path?: string },
): MarketplacePluginTreeResult {
  const plugins = ensureCatalogPlugins(harnesstapDir, input.marketplace);
  if (!plugins.some((plugin) => plugin.name === input.plugin)) {
    return { status: "not_found" };
  }

  const cacheDir = marketplaceCacheDir(harnesstapDir, input.marketplace);
  const pluginRoot = resolvePluginDirectory(cacheDir, input.plugin);
  if (!pluginRoot) {
    return { status: "not_found" };
  }

  const requestedPath = input.path?.trim();
  if (!requestedPath) {
    const files: string[] = [];
    collectFiles(pluginRoot, pluginRoot, files);
    files.sort();
    return {
      status: "ok",
      files: files.map((path) => ({ path, kind: "file" as const })),
    };
  }

  if (isInvalidPreviewPath(requestedPath)) {
    return { status: "invalid_path" };
  }

  const absolute = join(pluginRoot, requestedPath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return { status: "not_found" };
  }

  return {
    status: "ok",
    path: requestedPath,
    content: readFileSync(absolute, "utf8"),
  };
}
