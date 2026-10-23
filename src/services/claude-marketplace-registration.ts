import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harnesstapDirForHomeRoot } from "../db/connection.js";
import type { ClaudeMarketplaceSource, SerializedFile, SurfaceWarning } from "../types.js";
import { wellKnownMarketplaceEntry } from "./builtin-marketplaces.js";
import { findKnownMarketplace, isLocalFilesystemSource } from "./marketplace-registry.js";

/** Claude Code's list of marketplaces, keyed by marketplace name. */
export const CLAUDE_KNOWN_MARKETPLACES_PATH = ".claude/plugins/known_marketplaces.json";

/** Parent of the marketplace folders HarnessTap registers with Claude Code. */
export const HARNESSTAP_CLAUDE_MARKETPLACES_ROOT = ".claude/plugins/harnesstap-marketplaces";

/** Folder inside a marketplace folder that holds the plugin trees Claude Code installs from. */
export const MARKETPLACE_PLUGIN_TREE_DIR = "plugins";

/** The `source` of a marketplace entry: a `./` path inside the marketplace folder, as Claude Code requires. */
export function marketplacePluginSource(pluginName: string): string {
  return `./${MARKETPLACE_PLUGIN_TREE_DIR}/${pluginName}`;
}

/**
 * Folder HarnessTap registers as a marketplace's `installLocation`. It sits
 * apart from `~/.claude/plugins/marketplaces/`, where Claude Code clones the
 * marketplaces it adds itself, so neither ever writes into the other's folder.
 */
export function harnessTapClaudeMarketplaceDir(marketplace: string): string {
  return `${HARNESSTAP_CLAUDE_MARKETPLACES_ROOT}/${marketplace}`;
}

export interface ClaudeMarketplacePlugin {
  name: string;
  version: string;
  /** Install folder under home, `.claude/plugins/cache/<mp>/<name>/<version>`. */
  relativeRoot: string;
}

interface KnownMarketplaceEntry {
  source?: unknown;
  installLocation?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The marketplace source Claude Code records for a git URL. */
export function claudeMarketplaceSourceForUrl(url: string): ClaudeMarketplaceSource {
  const github = /^(?:https?:\/\/|git@)github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (github) return { source: "github", repo: `${github[1]}/${github[2]}` };
  return { source: "git", url: url.trim() };
}

/** Remote git URL HarnessTap fetches `marketplace` from, if it is not a local folder. */
export function remoteMarketplaceUrl(homeRoot: string, marketplace: string): string | undefined {
  if (!marketplace || marketplace === "local") return undefined;
  const entry = findKnownMarketplace(harnesstapDirForHomeRoot(homeRoot), marketplace)
    ?? wellKnownMarketplaceEntry(marketplace);
  const url = entry?.url?.trim();
  return url && !isLocalFilesystemSource(url) ? url : undefined;
}

function readKnownMarketplaces(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

/** Keys of the entry HarnessTap writes to `known_marketplaces.json`. */
const HARNESSTAP_ENTRY_KEYS = new Set(["source", "installLocation", "lastUpdated", "autoUpdate"]);

function sameJson(a: unknown, b: unknown): boolean {
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  return a === b;
}

/** Path of the marketplace manifest HarnessTap writes for `marketplace`. */
export function harnessTapClaudeMarketplaceManifestPath(marketplace: string): string {
  return `${harnessTapClaudeMarketplaceDir(marketplace)}/.claude-plugin/marketplace.json`;
}

/** True when HarnessTap's marketplace manifest for `marketplace` is on disk. */
function hasHarnessTapMarketplaceManifest(homeRoot: string, marketplace: string): boolean {
  const fullPath = join(homeRoot, harnessTapClaudeMarketplaceManifestPath(marketplace));
  if (!existsSync(fullPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(fullPath, "utf-8")) as unknown;
    return isRecord(parsed) && isRecord(parsed.owner) && parsed.owner.name === "HarnessTap";
  } catch {
    return false;
  }
}

/**
 * Who a `known_marketplaces.json` entry belongs to now:
 * - `harnesstap`: still the entry HarnessTap writes (its folder, its source,
 *   auto-update off or unset). Claude Code may have moved `lastUpdated`.
 * - `claude-changed`: HarnessTap registered the marketplace, but the entry was
 *   rewritten since (for example by `claude plugin marketplace update`, which
 *   re-clones the marketplace and points the entry at its own copy, or by
 *   turning auto-update on). HarnessTap leaves it as it is.
 * - `foreign`: an entry HarnessTap never wrote.
 */
export type ClaudeMarketplaceEntryOwner = "harnesstap" | "claude-changed" | "foreign";

export function claudeMarketplaceEntryOwner(
  homeRoot: string,
  marketplace: string,
  entry: unknown,
): ClaudeMarketplaceEntryOwner {
  if (!isRecord(entry)) return "foreign";
  const location = (entry as KnownMarketplaceEntry).installLocation;
  if (location !== join(homeRoot, harnessTapClaudeMarketplaceDir(marketplace))) {
    return hasHarnessTapMarketplaceManifest(homeRoot, marketplace) ? "claude-changed" : "foreign";
  }
  if (Object.keys(entry).some((key) => !HARNESSTAP_ENTRY_KEYS.has(key))) return "claude-changed";
  // Entries written before auto-update was turned off have no `autoUpdate`.
  if (entry.autoUpdate !== undefined && entry.autoUpdate !== false) return "claude-changed";
  if (typeof entry.lastUpdated !== "string" || !entry.lastUpdated) return "claude-changed";
  const url = remoteMarketplaceUrl(homeRoot, marketplace);
  if (url && !sameJson(entry.source, claudeMarketplaceSourceForUrl(url))) return "claude-changed";
  return "harnesstap";
}

/** The registration HarnessTap wrote and nothing changed since. */
export function isHarnessTapMarketplaceRegistration(
  homeRoot: string,
  marketplace: string,
  entry: unknown,
): boolean {
  return claudeMarketplaceEntryOwner(homeRoot, marketplace, entry) === "harnesstap";
}

/**
 * Marketplaces HarnessTap registered whose `known_marketplaces.json` entry
 * Claude Code (or the user) changed since, read from disk.
 */
export function claudeChangedMarketplaces(homeRoot: string): Set<string> {
  const fullPath = join(homeRoot, CLAUDE_KNOWN_MARKETPLACES_PATH);
  const changed = new Set<string>();
  if (!existsSync(fullPath)) return changed;
  let known: Record<string, unknown>;
  try {
    known = readKnownMarketplaces(readFileSync(fullPath, "utf-8"));
  } catch {
    return changed;
  }
  for (const [marketplace, entry] of Object.entries(known)) {
    if (claudeMarketplaceEntryOwner(homeRoot, marketplace, entry) === "claude-changed") {
      changed.add(marketplace);
    }
  }
  return changed;
}

/** Why HarnessTap leaves a changed marketplace entry alone. */
export function claudeChangedMarketplaceMessage(marketplace: string): string {
  return `Claude Code changed the entry for marketplace ${marketplace} in ~/${CLAUDE_KNOWN_MARKETPLACES_PATH} after HarnessTap registered it, so HarnessTap leaves it as it is.`;
}

/**
 * Register each marketplace with Claude Code so it loads the plugins installed
 * from it: an entry in `known_marketplaces.json` plus a marketplace folder whose
 * manifest lists those plugins at their install folders.
 *
 * A marketplace Claude Code already knows from elsewhere (the user added it)
 * keeps its entry; its own manifest then serves the plugin records. The file is
 * merged key by key, so other marketplaces stay as they are.
 *
 * Returns the marketplaces Claude Code can resolve after the write.
 */
export function emitClaudeMarketplaceRegistrations(
  files: SerializedFile[],
  homeRoot: string,
  byMarketplace: ReadonlyMap<string, readonly ClaudeMarketplacePlugin[]>,
  surfaceWarnings?: SurfaceWarning[],
): Set<string> {
  const registered = new Set<string>();
  if (byMarketplace.size === 0) return registered;
  const pending = files.find((file) => file.path === CLAUDE_KNOWN_MARKETPLACES_PATH)?.content;
  const onDisk = existsSync(join(homeRoot, CLAUDE_KNOWN_MARKETPLACES_PATH))
    ? readFileSync(join(homeRoot, CLAUDE_KNOWN_MARKETPLACES_PATH), "utf-8")
    : undefined;
  const known = readKnownMarketplaces(pending ?? onDisk);
  let changed = false;

  for (const [marketplace, plugins] of [...byMarketplace].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = known[marketplace];
    const owner = existing === undefined
      ? "harnesstap"
      : claudeMarketplaceEntryOwner(homeRoot, marketplace, existing);
    if (owner === "foreign") {
      registered.add(marketplace);
      continue;
    }
    const url = remoteMarketplaceUrl(homeRoot, marketplace);
    if (!url) {
      surfaceWarnings?.push({
        harness: "claude-code",
        path: CLAUDE_KNOWN_MARKETPLACES_PATH,
        category: "claude-marketplace",
        message: `HarnessTap does not know where marketplace ${marketplace} comes from, so Claude Code cannot load its plugins. Add it with \`ht marketplace add\`.`,
        alias_harnesses: [],
      });
      continue;
    }
    const dir = harnessTapClaudeMarketplaceDir(marketplace);
    if (owner === "claude-changed") {
      // Keep the entry as Claude Code left it. HarnessTap's manifest stays
      // tracked, so a status check keeps reporting the change and a switch
      // away removes the folder HarnessTap made.
      surfaceWarnings?.push({
        harness: "claude-code",
        path: CLAUDE_KNOWN_MARKETPLACES_PATH,
        category: "claude-marketplace-changed",
        message: claudeChangedMarketplaceMessage(marketplace),
        alias_harnesses: [],
      });
      writeHarnessTapMarketplaceManifest(files, marketplace, url, plugins);
      registered.add(marketplace);
      continue;
    }
    // Claude Code rejects the whole file when an entry lacks `lastUpdated`.
    // Keep the time already recorded so a re-apply writes the same bytes.
    const priorUpdated = isRecord(existing) ? existing.lastUpdated : undefined;
    known[marketplace] = {
      source: claudeMarketplaceSourceForUrl(url),
      installLocation: join(homeRoot, dir),
      lastUpdated: typeof priorUpdated === "string" && priorUpdated ? priorUpdated : new Date().toISOString(),
      // Claude Code refreshes a marketplace with auto-update on at startup by
      // re-cloning it into its own folder and repointing this entry. HarnessTap
      // keeps the marketplace up to date itself.
      autoUpdate: false,
    };
    changed = true;
    writeHarnessTapMarketplaceManifest(files, marketplace, url, plugins);
    registered.add(marketplace);
  }

  if (changed) {
    const content = `${JSON.stringify(known, null, 2)}\n`;
    const index = files.findIndex((file) => file.path === CLAUDE_KNOWN_MARKETPLACES_PATH);
    if (index >= 0) files[index] = { path: CLAUDE_KNOWN_MARKETPLACES_PATH, content };
    else files.push({ path: CLAUDE_KNOWN_MARKETPLACES_PATH, content });
  }
  return registered;
}

function writeHarnessTapMarketplaceManifest(
  files: SerializedFile[],
  marketplace: string,
  url: string,
  plugins: readonly ClaudeMarketplacePlugin[],
): void {
  const manifest = {
    name: marketplace,
    owner: { name: "HarnessTap" },
    description: `Plugins HarnessTap installed from ${url}.`,
    plugins: [...plugins]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        // Claude Code takes only a `./` path inside the marketplace folder:
        // the plugin tree HarnessTap keeps there is made by
        // `reconcileMarketplacePluginTrees`.
        source: marketplacePluginSource(plugin.name),
      })),
  };
  const manifestPath = harnessTapClaudeMarketplaceManifestPath(marketplace);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const index = files.findIndex((file) => file.path === manifestPath);
  if (index >= 0) files[index] = { path: manifestPath, content };
  else files.push({ path: manifestPath, content });
}
