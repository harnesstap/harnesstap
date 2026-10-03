import { basename } from "node:path";
import semver from "semver";

export type CatalogPluginContentType = "skill" | "command";

export interface CatalogPluginContent {
  type: CatalogPluginContentType;
  name: string;
  description?: string;
}

export interface CatalogPlugin {
  name: string;
  version?: string;
  ref: string;
  description?: string;
  tags?: string[];
  sourcePath?: string;
  contents?: CatalogPluginContent[];
}

export interface ParsedMarketplaceCatalog {
  marketplaceName: string;
  plugins: CatalogPlugin[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMarketplaceName(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const name = raw.name;
  return typeof name === "string" ? name : "";
}

function buildRef(name: string, marketplaceName: string): string {
  return marketplaceName ? `${name}@${marketplaceName}` : name;
}

function resolveVersion(entry: Record<string, unknown>): string | undefined {
  const version = entry.version;
  if (typeof version === "string" && version.length > 0) return version;

  const source = entry.source;
  if (!isRecord(source)) return undefined;

  const sha = source.sha;
  if (typeof sha === "string" && sha.length > 0) return sha.slice(0, 12);

  const ref = source.ref;
  if (typeof ref === "string" && ref.length > 0) return ref;

  return undefined;
}

function resolveDescription(entry: Record<string, unknown>): string | undefined {
  const description = entry.description;
  return typeof description === "string" && description.length > 0
    ? description
    : undefined;
}

function resolveTags(entry: Record<string, unknown>): string[] | undefined {
  const tags = entry.tags;
  if (!Array.isArray(tags)) return undefined;
  const next = tags.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
  return next.length > 0 ? next : undefined;
}

export function normalizeMarketplaceSourcePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function resolveSourcePath(entry: Record<string, unknown>): string | undefined {
  const source = entry.source;
  if (typeof source === "string" && source.trim().length > 0) {
    return normalizeMarketplaceSourcePath(source);
  }
  const path = entry.path;
  if (typeof path === "string" && path.trim().length > 0) {
    return normalizeMarketplaceSourcePath(path);
  }
  return undefined;
}

function parsePluginEntry(
  entry: unknown,
  marketplaceName: string,
  resolveName: (entry: Record<string, unknown>) => string | undefined,
): CatalogPlugin | undefined {
  if (!isRecord(entry)) return undefined;

  const name = resolveName(entry);
  if (!name) return undefined;

  const version = resolveVersion(entry);
  const description = resolveDescription(entry);
  const tags = resolveTags(entry);
  const sourcePath = resolveSourcePath(entry);
  const ref = buildRef(name, marketplaceName);

  return {
    name,
    ...(version !== undefined ? { version } : {}),
    ref,
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(sourcePath !== undefined ? { sourcePath } : {}),
  };
}

function parsePlugins(
  raw: unknown,
  marketplaceName: string,
  resolveName: (entry: Record<string, unknown>) => string | undefined,
): CatalogPlugin[] {
  if (!isRecord(raw)) return [];
  const plugins = raw.plugins;
  if (!Array.isArray(plugins)) return [];

  const parsed: CatalogPlugin[] = [];
  for (const entry of plugins) {
    const plugin = parsePluginEntry(entry, marketplaceName, resolveName);
    if (plugin) parsed.push(plugin);
  }
  return parsed;
}

function resolveClaudePluginName(entry: Record<string, unknown>): string | undefined {
  const name = entry.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function resolveCursorPluginName(entry: Record<string, unknown>): string | undefined {
  const name = entry.name;
  if (typeof name === "string" && name.length > 0) return name;

  const path = entry.path;
  if (typeof path === "string" && path.length > 0) {
    const derived = basename(path);
    return derived.length > 0 ? derived : undefined;
  }

  return undefined;
}

export function parseClaudeMarketplaceManifest(raw: unknown): ParsedMarketplaceCatalog {
  const marketplaceName = readMarketplaceName(raw);
  const plugins = parsePlugins(raw, marketplaceName, resolveClaudePluginName);
  return { marketplaceName, plugins };
}

export function parseCursorMarketplaceManifest(raw: unknown): ParsedMarketplaceCatalog {
  const marketplaceName = readMarketplaceName(raw);
  const plugins = parsePlugins(raw, marketplaceName, resolveCursorPluginName);
  return { marketplaceName, plugins };
}

function catalogSemver(version: string | undefined): string | null {
  if (!version?.trim()) return null;
  const trimmed = version.trim();
  const withoutV = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  return semver.valid(withoutV);
}

function preferCatalogPlugin(current: CatalogPlugin, incoming: CatalogPlugin): CatalogPlugin {
  const currentRank = catalogSemver(current.version);
  const incomingRank = catalogSemver(incoming.version);
  const preferIncoming =
    incomingRank !== null &&
    (currentRank === null || semver.rcompare(incomingRank, currentRank) < 0);

  const chosen = preferIncoming ? incoming : current;
  const other = preferIncoming ? current : incoming;
  const tags = uniqueStrings([...(chosen.tags ?? []), ...(other.tags ?? [])]);
  const contents = chosen.contents?.length ? chosen.contents : other.contents;
  return {
    ...chosen,
    version: chosen.version ?? other.version,
    description: chosen.description ?? other.description,
    sourcePath: chosen.sourcePath ?? other.sourcePath,
    ...(tags.length > 0 ? { tags } : {}),
    ...(contents && contents.length > 0 ? { contents } : {}),
  };
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

/** One catalog row per plugin name; later copies (other branches) merge into the first. */
export function mergeCatalogPluginsByIdentity(plugins: CatalogPlugin[]): CatalogPlugin[] {
  const byName = new Map<string, CatalogPlugin>();
  for (const plugin of plugins) {
    const existing = byName.get(plugin.name);
    if (!existing) {
      byName.set(plugin.name, plugin);
      continue;
    }
    byName.set(plugin.name, preferCatalogPlugin(existing, plugin));
  }
  return [...byName.values()];
}
