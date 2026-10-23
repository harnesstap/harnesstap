import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
  copyFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { harnesstapDirForHomeRoot } from "../db/connection.js";
import { removeFileOrLink } from "../utils/remove-file-or-link.js";
import {
  HARNESSTAP_CLAUDE_MARKETPLACES_ROOT,
  MARKETPLACE_PLUGIN_TREE_DIR,
  harnessTapClaudeMarketplaceManifestPath,
  hasHarnessTapMarketplaceManifest,
  marketplacePluginSource,
} from "./claude-marketplace-registration.js";
import { backupAndRewriteFile, hashFileOrLink } from "./safe-file-removal.js";

/**
 * Claude Code installs a plugin from a marketplace by copying the folder its
 * `marketplace.json` entry names, and accepts only a `./` path inside the
 * marketplace folder: no `..`, and no link that leaves the folder. The plugin
 * trees HarnessTap installs live in `~/.claude/plugins/cache/<mp>/<name>/<ver>`,
 * so each marketplace folder gets a `plugins/<name>` tree of its own, made of
 * hard links to the files of that cache folder (a copy where the file system
 * cannot link). It costs no disk space and follows `ht plugin update`.
 *
 * Ownership. The tree is derived: every file is a twin of a file in the cache
 * folder, whose own ownership rules and backups apply. A file here is removed
 * or replaced only when it is recorded in `<harnesstap>/cache/marketplace-plugin-trees.json`
 * and still has the recorded hash. A file you added, or one that changed since,
 * stays, and so does the folder around it.
 */
interface TreeRecords {
  version: 1;
  trees: Record<string, Record<string, string>>;
}

function recordsPath(homeRoot: string): string {
  return join(harnesstapDirForHomeRoot(homeRoot), "cache", "marketplace-plugin-trees.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecords(homeRoot: string): TreeRecords {
  try {
    const parsed = JSON.parse(readFileSync(recordsPath(homeRoot), "utf8")) as unknown;
    if (isRecord(parsed) && parsed.version === 1 && isRecord(parsed.trees)) {
      return { version: 1, trees: parsed.trees as TreeRecords["trees"] };
    }
  } catch {
    // No record yet.
  }
  return { version: 1, trees: {} };
}

function writeRecords(homeRoot: string, records: TreeRecords): void {
  try {
    mkdirSync(dirname(recordsPath(homeRoot)), { recursive: true });
    writeFileSync(recordsPath(homeRoot), `${JSON.stringify(records, null, 2)}\n`);
  } catch {
    // Best effort: an unrecorded file is only ever kept, never removed.
  }
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      // Claude Code's own bookkeeping in an installed folder is not part of the plugin.
      if (rel === ".in_use" || rel === ".orphaned_at" || rel === ".git" || rel === "node_modules") continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

function sameFile(a: string, b: string): boolean {
  try {
    const left = lstatSync(a);
    const right = lstatSync(b);
    return left.isFile() && right.isFile() && left.ino === right.ino && left.dev === right.dev && left.ino !== 0;
  } catch {
    return false;
  }
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function placeTwin(source: string, dest: string): boolean {
  try {
    mkdirSync(dirname(dest), { recursive: true });
    const stats = lstatSync(source);
    if (stats.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), dest);
      return true;
    }
    try {
      linkSync(source, dest);
    } catch {
      copyFileSync(source, dest);
    }
    return true;
  } catch {
    return false;
  }
}

function removeEmptyDirsUp(from: string, stop: string): void {
  let dir = from;
  while (dir.length > stop.length && dir.startsWith(stop)) {
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/** Make `target` hold twins of the files in `source`, touching only files it recorded. */
function syncTree(source: string, target: string, recorded: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  const wanted = listFiles(source);
  const wantedSet = new Set(wanted);
  for (const rel of wanted) {
    const from = join(source, rel);
    const to = join(target, rel);
    if (!present(to)) {
      if (placeTwin(from, to)) {
        const hash = hashFileOrLink(to);
        if (hash) next[rel] = hash;
      }
      continue;
    }
    if (sameFile(from, to)) {
      const hash = hashFileOrLink(to);
      if (hash) next[rel] = hash;
      continue;
    }
    const was = recorded[rel];
    if (was !== undefined && hashFileOrLink(to) === was) {
      const fromHash = hashFileOrLink(from);
      if (fromHash === was) {
        next[rel] = was;
        continue;
      }
      removeFileOrLink(to);
      if (placeTwin(from, to)) {
        const hash = hashFileOrLink(to);
        if (hash) next[rel] = hash;
      }
    }
    // Otherwise it is not ours, or changed since: leave it.
  }
  for (const [rel, was] of Object.entries(recorded)) {
    if (wantedSet.has(rel)) continue;
    const to = join(target, rel);
    if (!present(to)) continue;
    if (hashFileOrLink(to) === was) {
      removeFileOrLink(to);
      removeEmptyDirsUp(dirname(to), target);
    } else {
      next[rel] = was;
    }
  }
  return next;
}

/** Remove the recorded files of a tree that are unchanged; keep the rest. */
function dropTree(target: string, recorded: Record<string, string>, stop: string): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [rel, was] of Object.entries(recorded)) {
    const to = join(target, rel);
    if (!present(to)) continue;
    if (hashFileOrLink(to) === was) {
      removeFileOrLink(to);
      removeEmptyDirsUp(dirname(to), target);
    } else {
      kept[rel] = was;
    }
  }
  removeEmptyDirsUp(target, stop);
  return kept;
}

interface ListedPlugin {
  name: string;
  version: string;
}

function listedPlugins(manifestPath: string): ListedPlugin[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) return [];
  const out: ListedPlugin[] = [];
  for (const entry of parsed.plugins) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.version !== "string") continue;
    if (entry.source !== marketplacePluginSource(entry.name)) continue;
    if (!/^[^/\\]+$/.test(entry.name) || entry.name === "." || entry.name === "..") continue;
    out.push({ name: entry.name, version: entry.version });
  }
  return out;
}

/**
 * Bring the `plugins/<name>` trees of every HarnessTap marketplace folder in
 * line with its `marketplace.json` and the plugin folders in the cache: a
 * listed plugin whose cache folder exists gets its tree, any other tree
 * HarnessTap made goes. Safe to run any number of times.
 */
export function reconcileMarketplacePluginTrees(homeRoot: string): void {
  const root = join(homeRoot, HARNESSTAP_CLAUDE_MARKETPLACES_ROOT);
  const records = readRecords(homeRoot);
  const next: TreeRecords["trees"] = {};
  const handled = new Set<string>();

  let marketplaces: string[] = [];
  try {
    marketplaces = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // No HarnessTap marketplace folder.
  }
  for (const marketplace of marketplaces) {
    const dir = join(root, marketplace);
    // A folder Claude Code cloned a marketplace into (its own, or one that
    // `claude plugin marketplace update` made out of HarnessTap's) is not ours.
    if (!hasHarnessTapMarketplaceManifest(homeRoot, marketplace)) continue;
    for (const plugin of listedPlugins(join(dir, ".claude-plugin", "marketplace.json"))) {
      const view = join(homeRoot, ".claude", "plugins", "cache", marketplace, plugin.name, plugin.version.replace(/[\\/]/g, "-"));
      const target = join(dir, MARKETPLACE_PLUGIN_TREE_DIR, plugin.name);
      if (!existsSync(view)) continue;
      handled.add(target);
      const files = syncTree(view, target, records.trees[target] ?? {});
      if (Object.keys(files).length > 0) next[target] = files;
    }
  }
  for (const [target, recorded] of Object.entries(records.trees)) {
    if (handled.has(target)) continue;
    // The files there are the clone's now: forget them, touch nothing.
    if (isClonedMarketplaceFolder(homeRoot, target)) continue;
    const kept = dropTree(target, recorded, join(homeRoot, ".claude", "plugins"));
    if (Object.keys(kept).length > 0) next[target] = kept;
  }
  writeRecords(homeRoot, { version: 1, trees: next });
}

/** True when `target` lies in a marketplace folder whose manifest is not HarnessTap's. */
function isClonedMarketplaceFolder(homeRoot: string, target: string): boolean {
  const root = join(homeRoot, HARNESSTAP_CLAUDE_MARKETPLACES_ROOT);
  const rel = relative(root, target);
  if (rel.startsWith("..")) return false;
  const marketplace = rel.split(sep)[0];
  if (!marketplace) return false;
  return existsSync(join(homeRoot, harnessTapClaudeMarketplaceManifestPath(marketplace)))
    && !hasHarnessTapMarketplaceManifest(homeRoot, marketplace);
}

/**
 * Take the plugins a kept marketplace folder no longer has an install folder
 * for out of its `marketplace.json`: Claude Code fails an install of a listed
 * plugin whose source path is missing ("Source path does not exist"). A folder
 * stays when a plugin the user installed with Claude Code uses it, while the
 * plugins HarnessTap installed there are gone. Only HarnessTap's manifest is
 * rewritten (backed up first), and only when a listed plugin remains.
 * Returns true when the manifest was (or, on a dry run, would be) rewritten.
 */
export function pruneKeptMarketplaceManifest(
  homeRoot: string,
  marketplace: string,
  options: { applyId: string; snapshotId?: string | null; dryRun?: boolean },
): boolean {
  if (!hasHarnessTapMarketplaceManifest(homeRoot, marketplace)) return false;
  const relativePath = harnessTapClaudeMarketplaceManifestPath(marketplace);
  let raw: string;
  let parsed: unknown;
  try {
    raw = readFileSync(join(homeRoot, relativePath), "utf8");
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) return false;
  const remaining = parsed.plugins.filter((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.version !== "string") return true;
    const view = join(homeRoot, ".claude", "plugins", "cache", marketplace, entry.name, entry.version.replace(/[\\/]/g, "-"));
    return existsSync(view);
  });
  if (remaining.length === 0 || remaining.length === parsed.plugins.length) return false;
  if (options.dryRun) return true;
  backupAndRewriteFile({
    rootPath: homeRoot,
    relativePath,
    nextContent: `${JSON.stringify({ ...parsed, plugins: remaining }, null, 2)}\n`,
    applyId: options.applyId,
    snapshotId: options.snapshotId,
  });
  return true;
}
