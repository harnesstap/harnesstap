import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { isInvalidPreviewPath } from "../utils/preview-path.js";
import { builtinMarketplaceGitUrl } from "./builtin-marketplaces.js";
import {
  type VisibleMarketplaceEntry,
  listVisibleMarketplaces,
} from "./host-marketplaces.js";
import {
  isRelativePluginSourcePath,
  parseMarketplacePluginSource,
} from "./host-plugin-source.js";
import {
  type CatalogPlugin,
  ensureMarketplaceCatalog,
  listPluginsFromMarketplaceRoot,
  marketplaceCacheDir,
  readMarketplaceManifest,
} from "./marketplace-catalog.js";

export type MarketplaceTreeFile = { path: string; kind: "file" };

export type MarketplacePluginTreeResult =
  | { status: "ok"; files: MarketplaceTreeFile[] }
  | { status: "ok"; path: string; content: string }
  | { status: "not_found" }
  | { status: "invalid_path" };

type MarketplacePreviewTarget =
  | { kind: "dir"; path: string }
  | { kind: "remote" }
  | { kind: "missing" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function containedRelativeDir(root: string, sourcePath: string): string | undefined {
  const trimmed = sourcePath.trim().replaceAll("\\", "/");
  if (!trimmed || !isRelativePluginSourcePath(trimmed)) {
    return undefined;
  }
  const relativePath = trimmed.replace(/^\.\//, "");
  if (!relativePath || relativePath.split("/").includes("..")) {
    return undefined;
  }
  const absolute = join(root, relativePath);
  return isDirectory(absolute) ? absolute : undefined;
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

function manifestPluginEntries(root: string): unknown[] {
  const raw = readMarketplaceManifest(root);
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) {
    return [];
  }
  return raw.plugins;
}

function pluginEntryName(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.name === "string" && entry.name.length > 0) {
    return entry.name;
  }
  const parsed = parseMarketplacePluginSource(entry);
  const path = parsed?.path?.replace(/[/\\]+$/, "");
  if (!path) return undefined;
  const derived = basename(path);
  return derived.length > 0 ? derived : undefined;
}

function findManifestPluginEntry(root: string, pluginName: string): unknown | undefined {
  for (const entry of manifestPluginEntries(root)) {
    if (pluginEntryName(entry) === pluginName) {
      return entry;
    }
  }
  return undefined;
}

function resolvePreviewTarget(root: string, pluginName: string): MarketplacePreviewTarget {
  const entry = findManifestPluginEntry(root, pluginName);
  if (entry !== undefined) {
    const source = parseMarketplacePluginSource(entry);
    if (source?.url) {
      const localDir = source.path ? containedRelativeDir(root, source.path) : undefined;
      if (localDir) {
        return { kind: "dir", path: localDir };
      }
      return { kind: "remote" };
    }
    if (source?.path) {
      const fromSource = containedRelativeDir(root, source.path);
      if (fromSource) {
        return { kind: "dir", path: fromSource };
      }
      return { kind: "missing" };
    }
    const listedByName = resolvePluginDirectory(root, pluginName);
    if (listedByName) {
      return { kind: "dir", path: listedByName };
    }
    return { kind: "remote" };
  }

  const byName = resolvePluginDirectory(root, pluginName);
  if (byName) {
    return { kind: "dir", path: byName };
  }
  return { kind: "missing" };
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
  return ensureMarketplaceCatalog(harnesstapDir, { name: marketplace });
}

function previewFromRoot(
  cacheDir: string,
  plugin: string,
  path?: string,
): MarketplacePluginTreeResult {
  const target = resolvePreviewTarget(cacheDir, plugin);
  switch (target.kind) {
    case "missing":
      return { status: "not_found" };
    case "remote":
      if (path?.trim()) {
        return { status: "not_found" };
      }
      return { status: "ok", files: [] };
    case "dir":
      break;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }

  const pluginRoot = target.path;
  const requestedPath = path?.trim();
  if (!requestedPath) {
    const files: string[] = [];
    collectFiles(pluginRoot, pluginRoot, files);
    files.sort();
    return {
      status: "ok",
      files: files.map((filePath) => ({ path: filePath, kind: "file" as const })),
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

function catalogHasPlugin(plugins: CatalogPlugin[], pluginName: string): boolean {
  return plugins.some((plugin) => plugin.name === pluginName);
}

function listedMarketplacePlugins(
  harnesstapDir: string,
  entry: VisibleMarketplaceEntry,
): CatalogPlugin[] {
  if (entry.contentRoot && !entry.managed) {
    return listPluginsFromMarketplaceRoot(
      entry.contentRoot,
      entry.name,
      entry.platforms,
    );
  }
  if (entry.managed || builtinMarketplaceGitUrl(entry.name)) {
    return ensureMarketplaceCatalog(harnesstapDir, { name: entry.name });
  }
  return [];
}

export function filterOpenableMarketplacePlugins(
  root: string,
  plugins: CatalogPlugin[],
): CatalogPlugin[] {
  return plugins.filter(
    (plugin) => resolvePreviewTarget(root, plugin.name).kind !== "missing",
  );
}

export function listMarketplacePlugins(
  harnesstapDir: string,
  entry: VisibleMarketplaceEntry,
): CatalogPlugin[] {
  return listedMarketplacePlugins(harnesstapDir, entry);
}

export function previewMarketplacePlugin(
  harnesstapDir: string,
  input: { marketplace: string; plugin: string; path?: string },
): MarketplacePluginTreeResult {
  const visible = listVisibleMarketplaces(harnesstapDir).find(
    (entry) => entry.name === input.marketplace,
  );

  if (visible && !visible.managed) {
    if (visible.contentRoot) {
      const plugins = listMarketplacePlugins(harnesstapDir, visible);
      if (!catalogHasPlugin(plugins, input.plugin)) {
        return { status: "not_found" };
      }
      const openable = filterOpenableMarketplacePlugins(visible.contentRoot, plugins);
      if (!catalogHasPlugin(openable, input.plugin)) {
        return { status: "not_found" };
      }
      return previewFromRoot(visible.contentRoot, input.plugin, input.path);
    }
    if (!builtinMarketplaceGitUrl(visible.name)) {
      return { status: "not_found" };
    }
  }

  const plugins = ensureCatalogPlugins(harnesstapDir, input.marketplace);
  const cacheDir = marketplaceCacheDir(harnesstapDir, input.marketplace);
  const openable = filterOpenableMarketplacePlugins(cacheDir, plugins);
  if (!catalogHasPlugin(openable, input.plugin)) {
    return { status: "not_found" };
  }

  return previewFromRoot(cacheDir, input.plugin, input.path);
}
