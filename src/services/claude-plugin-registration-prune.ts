import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { readHostPluginViewRecord } from "./package-cache/host-plugin-views.js";
import {
  CLAUDE_KNOWN_MARKETPLACES_PATH,
  claudeChangedMarketplaceMessage,
  claudeMarketplaceEntryOwner,
  harnessTapClaudeMarketplaceDir,
} from "./claude-marketplace-registration.js";
import type { SerializedFile } from "../types.js";
import { applyJsonObjectUpdatePreservingFormat } from "./format-preserving-config.js";
import { backupAndRewriteFile } from "./safe-file-removal.js";

export const CLAUDE_INSTALLED_PLUGINS_PATH = ".claude/plugins/installed_plugins.json";
export const CLAUDE_SETTINGS_PATH = ".claude/settings.json";

/** Claude's plugin registries, which HarnessTap updates key by key. */
export function isClaudePluginRegistryPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized === CLAUDE_INSTALLED_PLUGINS_PATH || normalized === CLAUDE_KNOWN_MARKETPLACES_PATH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function recordInstallPath(homeRoot: string, row: unknown): string | undefined {
  if (!isRecord(row) || typeof row.installPath !== "string") return undefined;
  return isAbsolute(row.installPath)
    ? row.installPath
    : join(homeRoot, ".claude", "plugins", row.installPath);
}

function marketplaceOf(ref: string): string {
  const at = ref.lastIndexOf("@");
  return at > 0 ? ref.slice(at + 1) : "";
}

/**
 * Plugin records HarnessTap wrote that are going away: the record points at a
 * folder HarnessTap created (its host plugin view record says so) and
 * `isLeaving` says that folder is not part of what is applied now. Records the
 * user or Claude Code wrote never point at a folder HarnessTap created.
 */
export function staleHarnessTapClaudeRecords(
  homeRoot: string,
  installedRaw: string | undefined,
  isLeaving: (installPath: string) => boolean,
): Map<string, Set<string>> {
  const stale = new Map<string, Set<string>>();
  const plugins = parseObject(installedRaw)?.plugins;
  if (!isRecord(plugins)) return stale;
  for (const [ref, rows] of Object.entries(plugins)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const path = recordInstallPath(homeRoot, row);
      if (!path || !readHostPluginViewRecord(path)?.created || !isLeaving(path)) continue;
      const paths = stale.get(ref) ?? new Set<string>();
      paths.add(path);
      stale.set(ref, paths);
    }
  }
  return stale;
}

/**
 * True when a Claude Code registry file holds nothing but what HarnessTap
 * registered and is taking away: every `installed_plugins.json` record is in
 * `stale`, every `known_marketplaces.json` entry is still HarnessTap's own.
 * Only then may a switch remove the whole file; otherwise it loses just
 * HarnessTap's keys, so an entry Claude Code or the user added or changed in
 * the meantime stays.
 */
export function holdsOnlyLeavingHarnessTapRegistrations(
  homeRoot: string,
  relativePath: string,
  stale: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const parsed = parseObject(readHomeFile(homeRoot, normalized));
  if (!parsed) return false;
  if (normalized === CLAUDE_KNOWN_MARKETPLACES_PATH) {
    return Object.entries(parsed).every(([marketplace, entry]) =>
      claudeMarketplaceEntryOwner(homeRoot, marketplace, entry) === "harnesstap");
  }
  if (normalized === CLAUDE_INSTALLED_PLUGINS_PATH) {
    if (Object.keys(parsed).some((key) => key !== "version" && key !== "plugins")) return false;
    const plugins = isRecord(parsed.plugins) ? parsed.plugins : {};
    return Object.entries(plugins).every(([ref, rows]) =>
      Array.isArray(rows) && rows.every((row) => {
        const path = recordInstallPath(homeRoot, row);
        return path !== undefined && (stale.get(ref)?.has(path) ?? false);
      }));
  }
  return false;
}

export interface PrunedClaudeRegistrations {
  /** New file contents, by home-relative path. Unchanged files are left out. */
  files: Map<string, string>;
  /**
   * HarnessTap's marketplace entries that would have gone but stay because
   * Claude Code changed them after HarnessTap wrote them.
   */
  keptChangedMarketplaces: string[];
}

/**
 * Remove what HarnessTap registered with Claude Code for plugins that are
 * leaving, key by key: their `installed_plugins.json` records, their
 * `enabledPlugins` entries once no record is left for the plugin, and
 * HarnessTap's own marketplace entries that no plugin record uses any more and
 * `keepMarketplaces` does not name. Everything else in those files stays,
 * including a marketplace entry Claude Code changed since HarnessTap wrote it
 * (`changedMarketplaces` names those whose change is no longer visible on
 * disk, because HarnessTap's marketplace folder is already gone).
 */
export function pruneClaudeRegistrations(
  homeRoot: string,
  contents: {
    installed?: string;
    settings?: string;
    knownMarketplaces?: string;
  },
  stale: ReadonlyMap<string, ReadonlySet<string>>,
  keepMarketplaces: ReadonlySet<string> = new Set(),
  changedMarketplaces: ReadonlySet<string> = new Set(),
): PrunedClaudeRegistrations {
  const files = new Map<string, string>();
  const keptChangedMarketplaces: string[] = [];
  const installed = parseObject(contents.installed);
  const plugins = isRecord(installed?.plugins) ? { ...installed.plugins } : {};
  const gone = new Set<string>();

  if (installed && stale.size > 0) {
    let changed = false;
    for (const [ref, paths] of stale) {
      const rows = plugins[ref];
      if (!Array.isArray(rows)) continue;
      const kept = rows.filter((row) => {
        const path = recordInstallPath(homeRoot, row);
        return !path || !paths.has(path);
      });
      if (kept.length === rows.length) continue;
      changed = true;
      if (kept.length === 0) {
        delete plugins[ref];
        gone.add(ref);
      } else {
        plugins[ref] = kept;
      }
    }
    if (changed && contents.installed) {
      files.set(
        CLAUDE_INSTALLED_PLUGINS_PATH,
        applyJsonObjectUpdatePreservingFormat(contents.installed, { ...installed, plugins }),
      );
    }
  }

  const settings = parseObject(contents.settings);
  if (settings && contents.settings && gone.size > 0 && isRecord(settings.enabledPlugins)) {
    const enabled = { ...settings.enabledPlugins };
    const drop = Object.keys(enabled).filter((ref) => gone.has(ref) && enabled[ref] === true);
    if (drop.length > 0) {
      for (const ref of drop) delete enabled[ref];
      const next = { ...settings };
      if (Object.keys(enabled).length === 0) delete next.enabledPlugins;
      else next.enabledPlugins = enabled;
      files.set(
        CLAUDE_SETTINGS_PATH,
        applyJsonObjectUpdatePreservingFormat(contents.settings, next),
      );
    }
  }

  const known = parseObject(contents.knownMarketplaces);
  if (known && contents.knownMarketplaces) {
    const used = new Set(Object.keys(plugins).map(marketplaceOf));
    const next = { ...known };
    let changed = false;
    for (const [marketplace, entry] of Object.entries(known)) {
      if (keepMarketplaces.has(marketplace) || used.has(marketplace)) continue;
      const owner = claudeMarketplaceEntryOwner(homeRoot, marketplace, entry);
      if (owner === "claude-changed" || changedMarketplaces.has(marketplace)) {
        keptChangedMarketplaces.push(marketplace);
        continue;
      }
      if (owner !== "harnesstap") continue;
      delete next[marketplace];
      changed = true;
    }
    if (changed) {
      files.set(
        CLAUDE_KNOWN_MARKETPLACES_PATH,
        applyJsonObjectUpdatePreservingFormat(contents.knownMarketplaces, next),
      );
    }
  }

  return { files, keptChangedMarketplaces };
}

function readHomeFile(homeRoot: string, relativePath: string): string | undefined {
  const fullPath = join(homeRoot, relativePath);
  if (!existsSync(fullPath)) return undefined;
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return undefined;
  }
}

function folderPaths(files: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

function leavingInstallPath(homeRoot: string, files: readonly string[]): (path: string) => boolean {
  const dirs = folderPaths(files);
  return (installPath) => !dirs.has(relative(homeRoot, installPath).split(sep).join("/"));
}

const HT_MARKETPLACE_MANIFEST_RE =
  /^\.claude\/plugins\/harnesstap-marketplaces\/([^/]+)\/\.claude-plugin\/marketplace\.json$/;

function writtenHarnessTapMarketplaces(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const name = HT_MARKETPLACE_MANIFEST_RE.exec(file)?.[1];
    if (name && file === `${harnessTapClaudeMarketplaceDir(name)}/.claude-plugin/marketplace.json`) {
      names.add(name);
    }
  }
  return names;
}

/** Plugin records HarnessTap wrote whose folders no file in `desiredFiles` lies in. */
export function planStaleClaudeRegistrations(
  homeRoot: string,
  desiredFiles: readonly string[],
): Map<string, Set<string>> {
  return staleHarnessTapClaudeRecords(
    homeRoot,
    readHomeFile(homeRoot, CLAUDE_INSTALLED_PLUGINS_PATH),
    leavingInstallPath(homeRoot, desiredFiles),
  );
}

/**
 * A global profile apply emits Claude Code's registry files merged with what
 * is on disk, so records HarnessTap wrote for plugins an earlier profile
 * installed would stay. Take out the ones whose folders this apply does not
 * write, before the files are written.
 */
export function pruneLeavingClaudeRegistrations(
  files: SerializedFile[],
  homeRoot: string,
): SerializedFile[] {
  const paths = files.map((file) => file.path);
  const pendingOrOnDisk = (relativePath: string): string | undefined =>
    files.find((file) => file.path === relativePath)?.content
    ?? readHomeFile(homeRoot, relativePath);
  const installed = pendingOrOnDisk(CLAUDE_INSTALLED_PLUGINS_PATH);
  const stale = staleHarnessTapClaudeRecords(homeRoot, installed, leavingInstallPath(homeRoot, paths));
  const pruned = pruneClaudeRegistrations(
    homeRoot,
    {
      installed,
      settings: pendingOrOnDisk(CLAUDE_SETTINGS_PATH),
      knownMarketplaces: pendingOrOnDisk(CLAUDE_KNOWN_MARKETPLACES_PATH),
    },
    stale,
    writtenHarnessTapMarketplaces(paths),
  );
  if (pruned.files.size === 0) return files;
  // Only files this apply writes anyway: one it leaves alone is pruned on
  // disk after the switch removes the plugin folders.
  return files.map((file) => {
    const content = pruned.files.get(file.path);
    return content === undefined ? file : { ...file, content };
  });
}

/**
 * After a switch removed HarnessTap's plugin folders, take its registrations
 * for them out of the Claude Code files that stayed (files the user had before
 * HarnessTap, or changed). Each file is backed up before it is rewritten.
 * Returns the paths rewritten (or that would be, on a dry run) and a warning
 * for each marketplace entry kept because Claude Code changed it.
 * `changedMarketplaces` comes from `claudeChangedMarketplaces`, read before
 * the switch removed HarnessTap's marketplace folders.
 */
export function pruneStaleClaudeRegistrationsOnDisk(
  homeRoot: string,
  stale: ReadonlyMap<string, ReadonlySet<string>>,
  desiredFiles: readonly string[],
  options: {
    applyId: string;
    snapshotId?: string | null;
    dryRun?: boolean;
    changedMarketplaces?: ReadonlySet<string>;
  },
): { rewritten: string[]; warnings: string[] } {
  const desired = new Set(desiredFiles);
  const keepMarketplaces = writtenHarnessTapMarketplaces(desiredFiles);
  const pruned = pruneClaudeRegistrations(
    homeRoot,
    {
      installed: readHomeFile(homeRoot, CLAUDE_INSTALLED_PLUGINS_PATH),
      settings: readHomeFile(homeRoot, CLAUDE_SETTINGS_PATH),
      knownMarketplaces: readHomeFile(homeRoot, CLAUDE_KNOWN_MARKETPLACES_PATH),
    },
    stale,
    keepMarketplaces,
    options.changedMarketplaces,
  );
  const rewritten: string[] = [];
  for (const [relativePath, content] of pruned.files) {
    // A file this apply writes already holds only what it wants.
    if (desired.has(relativePath)) continue;
    if (!options.dryRun) {
      backupAndRewriteFile({
        rootPath: homeRoot,
        relativePath,
        nextContent: content,
        applyId: options.applyId,
        snapshotId: options.snapshotId,
      });
    }
    rewritten.push(relativePath);
  }
  const warnings = pruned.keptChangedMarketplaces.map((marketplace) =>
    `${claudeChangedMarketplaceMessage(marketplace)} Remove it with \`claude plugin marketplace remove ${marketplace}\` if you no longer use it.`);
  return { rewritten, warnings };
}
