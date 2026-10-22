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

/** The registration HarnessTap wrote: it points at HarnessTap's folder. */
export function isHarnessTapMarketplaceRegistration(
  homeRoot: string,
  marketplace: string,
  entry: unknown,
): boolean {
  if (!isRecord(entry)) return false;
  const location = (entry as KnownMarketplaceEntry).installLocation;
  return location === join(homeRoot, harnessTapClaudeMarketplaceDir(marketplace));
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
    if (existing !== undefined && !isHarnessTapMarketplaceRegistration(homeRoot, marketplace, existing)) {
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
    known[marketplace] = {
      source: claudeMarketplaceSourceForUrl(url),
      installLocation: join(homeRoot, dir),
    };
    changed = true;
    const manifest = {
      name: marketplace,
      owner: { name: "HarnessTap" },
      description: `Plugins HarnessTap installed from ${url}.`,
      plugins: [...plugins]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((plugin) => ({
          name: plugin.name,
          version: plugin.version,
          // Relative to the marketplace folder: two levels up is ~/.claude/plugins.
          source: `../../${plugin.relativeRoot.replace(/^\.claude\/plugins\//, "")}`,
        })),
    };
    const manifestPath = `${dir}/.claude-plugin/marketplace.json`;
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    const index = files.findIndex((file) => file.path === manifestPath);
    if (index >= 0) files[index] = { path: manifestPath, content };
    else files.push({ path: manifestPath, content });
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
