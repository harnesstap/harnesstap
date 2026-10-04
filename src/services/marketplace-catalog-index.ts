import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import {
  HOST_PLUGIN_MANIFEST_RELATIVE_PATHS,
  readFirstHostPluginManifest,
} from "../plugins/host-plugin-manifest.js";
import type {
  CatalogPlugin,
  CatalogPluginContent,
} from "./marketplace-catalog-parse.js";
import { discoverSkillPackage } from "./skill-discovery.js";

const PLUGIN_ROOT_WALK_SKIP = new Set([".git", "node_modules", ".hg"]);
const PLUGIN_ROOT_WALK_MAX_DEPTH = 6;
const COMMAND_DIRS = ["commands", ".claude/commands"] as const;

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function looksLikePluginRoot(path: string): boolean {
  for (const relative of HOST_PLUGIN_MANIFEST_RELATIVE_PATHS) {
    if (existsSync(join(path, relative))) return true;
  }
  return isDirectory(join(path, "skills")) || isDirectory(join(path, "commands"));
}

function walkNamedPluginRoot(
  dir: string,
  pluginName: string,
  depth: number,
): string | undefined {
  if (depth > PLUGIN_ROOT_WALK_MAX_DEPTH || !isDirectory(dir)) {
    return undefined;
  }
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || PLUGIN_ROOT_WALK_SKIP.has(entry.name)) {
        continue;
      }
      const child = join(dir, entry.name);
      if (entry.name === pluginName && looksLikePluginRoot(child)) {
        return child;
      }
      const nested = walkNamedPluginRoot(child, pluginName, depth + 1);
      if (nested) return nested;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function resolveMarketplaceCatalogPluginRoot(
  marketplaceRoot: string,
  plugin: Pick<CatalogPlugin, "name" | "sourcePath">,
): string | undefined {
  if (plugin.sourcePath) {
    const fromSource = join(marketplaceRoot, plugin.sourcePath);
    if (isDirectory(fromSource)) return fromSource;
  }
  const underPlugins = join(marketplaceRoot, "plugins", plugin.name);
  if (isDirectory(underPlugins) && looksLikePluginRoot(underPlugins)) {
    return underPlugins;
  }
  const atRoot = join(marketplaceRoot, plugin.name);
  if (isDirectory(atRoot) && looksLikePluginRoot(atRoot)) {
    return atRoot;
  }
  return walkNamedPluginRoot(marketplaceRoot, plugin.name, 0);
}

function commandContents(pluginRoot: string): CatalogPluginContent[] {
  const contents: CatalogPluginContent[] = [];
  const seen = new Set<string>();
  for (const relative of COMMAND_DIRS) {
    const dir = join(pluginRoot, relative);
    if (!isDirectory(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir, { encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.replace(/\.(md|toml)$/, "");
      if (name === entry || seen.has(name)) continue;
      const absolute = join(dir, entry);
      let description: string | undefined;
      if (entry.endsWith(".md")) {
        try {
          const parsed = matter(readFileSync(absolute, "utf8"));
          if (typeof parsed.data.description === "string") {
            description = parsed.data.description;
          }
        } catch {
          description = undefined;
        }
      }
      seen.add(name);
      contents.push({
        type: "command",
        name,
        ...(description ? { description } : {}),
      });
    }
  }
  return contents;
}

export function enrichCatalogPlugin(
  marketplaceRoot: string,
  plugin: CatalogPlugin,
): CatalogPlugin {
  const pluginRoot = resolveMarketplaceCatalogPluginRoot(marketplaceRoot, plugin);
  if (!pluginRoot) return plugin;

  const manifest = readFirstHostPluginManifest(pluginRoot);
  const description = plugin.description ?? manifest?.description;
  const keywords = (manifest?.keywords ?? []).filter(
    (keyword): keyword is string =>
      typeof keyword === "string" && keyword.trim().length > 0,
  );
  const tags = uniqueStrings([...(plugin.tags ?? []), ...keywords]);

  let skills: ReturnType<typeof discoverSkillPackage> = [];
  try {
    skills = discoverSkillPackage(pluginRoot);
  } catch {
    skills = [];
  }
  const contents: CatalogPluginContent[] = [
    ...skills.map((skill) => ({
      type: "skill" as const,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
    })),
    ...commandContents(pluginRoot),
  ];

  return {
    ...plugin,
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(contents.length > 0 ? { contents } : {}),
  };
}

export function enrichCatalogPlugins(
  marketplaceRoot: string,
  plugins: CatalogPlugin[],
): CatalogPlugin[] {
  if (!isDirectory(marketplaceRoot)) return plugins;
  return plugins.map((plugin) => enrichCatalogPlugin(marketplaceRoot, plugin));
}

export function catalogPluginMatchesQuery(plugin: CatalogPlugin, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (plugin.name.toLowerCase().includes(needle)) return true;
  if (plugin.ref.toLowerCase().includes(needle)) return true;
  if (plugin.description?.toLowerCase().includes(needle)) return true;
  for (const tag of plugin.tags ?? []) {
    if (tag.toLowerCase().includes(needle)) return true;
  }
  for (const content of plugin.contents ?? []) {
    if (content.name.toLowerCase().includes(needle)) return true;
    if (content.description?.toLowerCase().includes(needle)) return true;
  }
  return false;
}
