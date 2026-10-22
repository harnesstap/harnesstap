import {
  type Dirent,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import { getHarnesstapDir } from "../../db/connection.js";
import { parsePluginRef } from "../../plugins/claude-installed.js";
import {
  findPackageCacheEntry,
  upsertPackageCacheEntry,
} from "../../models/package-cache-entry.js";
import { cacheVersionDir } from "../host-plugin-source.js";
import { claudeEmitDerivedPaths } from "../host-plugin-spec-emit.js";
import { isPluginInstallRoot } from "../plugin-source-import.js";
import {
  classifyManagedPathOwnership,
  hashFileOrLink,
  hashOnDiskFile,
  isSymlinkPath,
} from "../safe-file-removal.js";
import {
  type KeptHostPluginViewFiles,
  type KeptHostPluginViewReason,
  hostPluginViewForceReplace,
  recordKeptHostPluginViewFiles,
  recordReplacedHostPluginViewFiles,
} from "./host-plugin-view-policy.js";
import { backUpAndRemoveHostPluginViewFiles } from "./host-plugin-view-backups.js";
import {
  readHostPluginViewRecord,
  recordHostPluginViewFiles,
  removeEmptyDirsUnder,
  swapKeptNoticeSignature,
} from "./host-plugin-views.js";
import {
  hostPluginPackageDir,
  hostPluginPackageRelativePath,
} from "./paths.js";

function shouldCopyPackageTreePath(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath).replace(/\\/g, "/");
  if (rel === "" || rel === ".") {
    return true;
  }
  if (rel === ".git" || rel.startsWith(".git/")) {
    return false;
  }
  if (rel === "node_modules" || rel.startsWith("node_modules/")) {
    return false;
  }
  return true;
}

function copyPackageTree(sourceRoot: string, destRoot: string): void {
  // Links are copied as links with their target unchanged, so a relative
  // link keeps pointing at its sibling instead of at the source checkout.
  cpSync(sourceRoot, destRoot, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    filter: (path) => shouldCopyPackageTreePath(sourceRoot, path),
  });
}

function linkTarget(path: string): string | undefined {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Earlier versions copied package trees following links, which turned a
 * relative link into an absolute one into the source checkout (sometimes a
 * scratch folder deleted since). Put such links in HarnessTap's own package
 * cache back to the target the source has.
 */
function repairPackageTreeLinks(sourceRoot: string, destRoot: string): void {
  const links = listTreeFiles(sourceRoot, (path) => shouldCopyPackageTreePath(sourceRoot, path))
    .filter((path) => isSymlinkPath(join(sourceRoot, path)));
  for (const path of links) {
    const target = linkTarget(join(sourceRoot, path));
    const dest = join(destRoot, path);
    if (target === undefined || !isSymlinkPath(dest) || linkTarget(dest) === target) continue;
    rmSync(dest, { force: true });
    symlinkSync(target, dest);
  }
}

export {
  type KeptHostPluginViewFiles,
  type KeptHostPluginViewReason,
  type ReplacedHostPluginViewFiles,
  setHostPluginViewForceReplace,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "./host-plugin-view-policy.js";

function listTreeFiles(root: string, filter?: (absolutePath: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (filter && !filter(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return files.sort();
}

const hashViewEntry = hashFileOrLink;

function sameBytes(left: string, right: string): boolean {
  const leftLink = isSymlinkPath(left);
  if (leftLink || isSymlinkPath(right)) {
    return leftLink && isSymlinkPath(right) && linkTarget(left) === linkTarget(right);
  }
  try {
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

function hostViewFileOwnership(input: {
  homeRoot: string;
  hostView: string;
  path: string;
  recorded: Record<string, string>;
}): "owned" | KeptHostPluginViewReason {
  const absolute = join(input.hostView, input.path);
  const recorded = input.recorded[input.path];
  if (recorded) {
    if (recorded === hashViewEntry(absolute)) return "owned";
    // Records from before links were kept as links hold the linked bytes.
    if (isSymlinkPath(absolute) && recorded === hashOnDiskFile(absolute)) return "owned";
    return "modified";
  }
  const fromHome = relative(input.homeRoot, absolute).split(sep).join("/");
  const ownership = classifyManagedPathOwnership(input.homeRoot, fromHome);
  return ownership === "unowned" ? "unmanaged" : ownership;
}

function copyViewFiles(
  canonicalDir: string,
  hostView: string,
  paths: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    const source = join(canonicalDir, path);
    const dest = join(hostView, path);
    mkdirSync(dirname(dest), { recursive: true });
    if (isSymlinkPath(source)) {
      const target = linkTarget(source);
      if (target === undefined) continue;
      symlinkSync(target, dest);
    } else {
      cpSync(source, dest, { force: true });
    }
    const hash = hashViewEntry(dest);
    if (hash) hashes[path] = hash;
  }
  return hashes;
}

/** How one file of a host plugin folder differs from the plugin's package tree. */
export interface HostPluginViewDifference {
  /** Path inside the folder. */
  path: string;
  /**
   * - `missing`: the plugin has it, the folder does not
   * - `stale`: HarnessTap wrote it unchanged, the plugin's bytes differ or it left the plugin
   * - `modified` / `unmanaged`: changed since HarnessTap wrote it, or not written by
   *   HarnessTap; a refresh keeps it
   */
  state: "missing" | "stale" | KeptHostPluginViewReason;
}

/**
 * Compare a host plugin cache folder with the plugin's package tree without
 * changing anything: what the next refresh would add, replace or keep.
 */
export function diffHostPluginView(input: {
  homeRoot: string;
  hostView: string;
  canonicalDir: string;
}): HostPluginViewDifference[] {
  const { hostView, canonicalDir } = input;
  if (!existsSync(hostView) || !existsSync(canonicalDir) || hostView === canonicalDir) return [];
  const packageFiles = listTreeFiles(canonicalDir, (path) =>
    shouldCopyPackageTreePath(canonicalDir, path),
  );
  const packageSet = new Set(packageFiles);
  const recorded = { ...(readHostPluginViewRecord(hostView)?.files ?? {}) };
  const differences: HostPluginViewDifference[] = [];
  const present = new Set<string>();
  for (const path of listTreeFiles(hostView)) {
    present.add(path);
    if (packageSet.has(path) && sameBytes(join(hostView, path), join(canonicalDir, path))) continue;
    const ownership = hostViewFileOwnership({ homeRoot: input.homeRoot, hostView, path, recorded });
    differences.push({ path, state: ownership === "owned" ? "stale" : ownership });
  }
  for (const path of packageFiles) {
    if (!present.has(path)) differences.push({ path, state: "missing" });
  }
  return differences.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Write a plugin's package tree into the host plugin cache folder
 * (`~/.claude/plugins/cache/<mkt>/<name>/<ver>`).
 *
 * An existing folder is never removed wholesale. Files that already match
 * are left as they are. A file that differs or is no longer in the package is
 * replaced or removed only when HarnessTap wrote it and it is unchanged since;
 * every replaced or removed file is backed up first. Files HarnessTap did not
 * write, or that changed since, are kept and reported through
 * `takeKeptHostPluginViewFiles` (replaced only with `--force-remove`, or when
 * the user agrees). Only folders left empty are removed.
 */
export function mirrorHostPluginView(input: {
  homeRoot: string;
  marketplace: string;
  pluginName: string;
  version: string;
  canonicalDir: string;
}): string {
  const hostView = cacheVersionDir(
    input.homeRoot,
    input.marketplace,
    input.pluginName,
    input.version,
  );
  if (
    existsSync(hostView)
    && isPluginInstallRoot(hostView)
    && hostView === input.canonicalDir
  ) {
    return hostView;
  }
  const packageFiles = listTreeFiles(input.canonicalDir, (path) =>
    shouldCopyPackageTreePath(input.canonicalDir, path),
  );
  if (!existsSync(hostView)) {
    mkdirSync(hostView, { recursive: true });
    const files = copyViewFiles(input.canonicalDir, hostView, packageFiles);
    recordHostPluginViewFiles({ hostView, created: true, files });
    return hostView;
  }

  const record = readHostPluginViewRecord(hostView);
  const created = record?.created === true;
  const recorded = { ...(record?.files ?? {}) };
  const packageSet = new Set(packageFiles);
  const applyWrites = claudeEmitDerivedPaths(input.canonicalDir, packageFiles);
  const unchanged = new Set<string>();
  const replace: string[] = [];
  const ownedPaths = new Set<string>();
  const kept: KeptHostPluginViewFiles["files"] = [];
  for (const path of listTreeFiles(hostView)) {
    if (packageSet.has(path) && sameBytes(join(hostView, path), join(input.canonicalDir, path))) {
      unchanged.add(path);
      continue;
    }
    const ownership = hostViewFileOwnership({
      homeRoot: input.homeRoot,
      hostView,
      path,
      recorded,
    });
    if (ownership === "owned" && applyWrites.has(path)) {
      // The apply writes this file with its own bytes (for example the Claude
      // manifest made from the package's root plugin.json). Replacing it here
      // would only make the apply write it again, with a new backup, each run.
      unchanged.add(path);
      continue;
    }
    if (ownership === "owned") ownedPaths.add(path);
    if (ownership === "owned" || hostPluginViewForceReplace()) {
      replace.push(path);
    } else {
      kept.push({ path, reason: ownership, inPlugin: packageSet.has(path) });
    }
  }

  const backupId = backUpAndRemoveHostPluginViewFiles({
    homeRoot: input.homeRoot,
    hostView,
    paths: replace,
  });
  if (backupId) {
    recordReplacedHostPluginViewFiles({
      hostView,
      backupId,
      files: replace,
      notWrittenByHarnessTap: replace.filter((path) => !ownedPaths.has(path)),
    });
  }
  const keptSet = new Set(kept.map((file) => file.path));
  const files = copyViewFiles(
    input.canonicalDir,
    hostView,
    packageFiles.filter((path) => !unchanged.has(path) && !keptSet.has(path)),
  );
  for (const path of unchanged) {
    const hash = recorded[path];
    if (hash) {
      files[path] = hash;
    } else if (
      hostViewFileOwnership({ homeRoot: input.homeRoot, hostView, path, recorded }) === "owned"
    ) {
      // An apply owns it (for example after a revert restored it): record it too.
      const current = hashViewEntry(join(hostView, path));
      if (current) files[path] = current;
    }
  }
  removeEmptyDirsInside(hostView);
  recordHostPluginViewFiles({ hostView, created, files, dropFiles: replace });
  const alreadyReported = swapKeptNoticeSignature(
    hostView,
    keptSignature(hostView, input.canonicalDir, kept),
  );
  if (kept.length > 0) {
    recordKeptHostPluginViewFiles({
      homeRoot: input.homeRoot,
      hostView,
      canonicalDir: input.canonicalDir,
      files: kept,
      alreadyReported,
    });
  }
  return hostView;
}

/**
 * Identifies a set of kept files: their paths, why they were kept, their
 * bytes and the plugin's bytes. It changes when either side changes, which
 * is when the kept-files notice is shown again. Empty when nothing was kept.
 */
function keptSignature(
  hostView: string,
  canonicalDir: string,
  kept: KeptHostPluginViewFiles["files"],
): string {
  if (kept.length === 0) return "";
  const hash = createHash("sha256");
  for (const file of [...kept].sort((a, b) => a.path.localeCompare(b.path))) {
    const ours = file.inPlugin ? hashViewEntry(join(canonicalDir, file.path)) ?? "" : "";
    hash.update(`${file.path}\0${file.reason}\0${hashViewEntry(join(hostView, file.path)) ?? ""}\0${ours}\n`);
  }
  return hash.digest("hex");
}

/** Remove the empty folders inside `dir`, never `dir` itself. */
function removeEmptyDirsInside(dir: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = join(dir, entry);
    try {
      if (lstatSync(child).isDirectory()) removeEmptyDirsUnder(child);
    } catch {
      // Unreadable entries stay.
    }
  }
}

/**
 * Replace the files a refresh kept, once the user agreed: back each one up,
 * then write the package version (or leave it removed when the package no
 * longer has it). Returns the paths replaced or removed, inside the folder.
 */
/**
 * Replace the files a refresh kept, after backing them up. Returns the
 * replaced paths and the backup id `ht revert` takes.
 */
export function replaceKeptHostPluginViewFiles(
  entry: KeptHostPluginViewFiles,
): { paths: string[]; backupId?: string } {
  if (!existsSync(entry.hostView)) return { paths: [] };
  const paths = entry.files.map((file) => file.path);
  const present = paths.filter((path) => {
    const full = join(entry.hostView, path);
    return existsSync(full) || isSymlinkPath(full);
  });
  const backupId = backUpAndRemoveHostPluginViewFiles({
    homeRoot: entry.homeRoot,
    hostView: entry.hostView,
    paths: present,
  });
  const packaged = paths.filter((path) => {
    const full = join(entry.canonicalDir, path);
    return existsSync(full) || isSymlinkPath(full);
  });
  mkdirSync(entry.hostView, { recursive: true });
  const files = copyViewFiles(entry.canonicalDir, entry.hostView, packaged);
  removeEmptyDirsInside(entry.hostView);
  recordHostPluginViewFiles({ hostView: entry.hostView, created: false, files, dropFiles: present });
  return { paths, backupId };
}

export function ingestHostPluginTreeIntoCache(input: {
  harnesstapDir: string;
  homeRoot: string;
  originRef: string;
  sourceInstallRoot: string;
  version: string;
  pluginPinResourceId?: string | null;
}): string {
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    return input.sourceInstallRoot;
  }
  const canonical = hostPluginPackageDir(
    input.harnesstapDir,
    marketplace,
    name,
    input.version,
  );
  if (!existsSync(canonical) || !isPluginInstallRoot(canonical)) {
    mkdirSync(dirname(canonical), { recursive: true });
    if (existsSync(canonical)) {
      rmSync(canonical, { recursive: true, force: true });
    }
    copyPackageTree(input.sourceInstallRoot, canonical);
  } else if (canonical !== input.sourceInstallRoot) {
    repairPackageTreeLinks(input.sourceInstallRoot, canonical);
  }
  const relative = hostPluginPackageRelativePath(marketplace, name, input.version);
  upsertPackageCacheEntry({
    kind: "host_plugin",
    origin_ref: input.originRef,
    resolved_key: input.version,
    relative_path: relative,
    resource_id: input.pluginPinResourceId ?? null,
  });
  mirrorHostPluginView({
    homeRoot: input.homeRoot,
    marketplace,
    pluginName: name,
    version: input.version,
    canonicalDir: canonical,
  });
  return canonical;
}

export function resolveCanonicalHostPluginRoot(input: {
  harnesstapDir: string;
  originRef: string;
  version?: string | null;
}): string | undefined {
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    return undefined;
  }
  const version = input.version?.trim();
  if (!version) {
    return undefined;
  }
  const onDisk = hostPluginPackageDir(
    harnesstapDir,
    marketplace,
    name,
    version,
  );
  if (existsSync(onDisk) && isPluginInstallRoot(onDisk)) {
    return onDisk;
  }
  const entry = findPackageCacheEntry({
    kind: "host_plugin",
    origin_ref: input.originRef,
    resolved_key: version,
  });
  if (entry) {
    const path = join(harnesstapDir, entry.relative_path);
    if (existsSync(path) && isPluginInstallRoot(path)) {
      return path;
    }
  }
  return undefined;
}

export {
  isInHostPluginViewCreatedByHarnessTap,
  pruneCreatedHostPluginView,
} from "./host-plugin-views.js";
