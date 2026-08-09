import { basename } from "node:path";

export interface CatalogPlugin {
  name: string;
  version?: string;
  ref: string;
  description?: string;
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
  const ref = buildRef(name, marketplaceName);

  return {
    name,
    ...(version !== undefined ? { version } : {}),
    ref,
    ...(description !== undefined ? { description } : {}),
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
