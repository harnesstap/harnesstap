/**
 * Process state for host plugin cache refreshes, kept free of imports so the
 * CLI entry can read it without loading the services.
 */
export type KeptHostPluginViewReason = "unmanaged" | "modified";

/** Files a host plugin refresh left in place because HarnessTap did not write them. */
export interface KeptHostPluginViewFiles {
  homeRoot: string;
  hostView: string;
  canonicalDir: string;
  files: Array<{
    path: string;
    reason: KeptHostPluginViewReason;
    /** False when the plugin has no such file, so a refresh would remove it. */
    inPlugin?: boolean;
  }>;
  /** Same files, same bytes and same plugin files as the last report: say nothing. */
  alreadyReported?: boolean;
}

/** Files a host plugin refresh backed up, then replaced or removed. */
export interface ReplacedHostPluginViewFiles {
  hostView: string;
  /** The id `ht revert` takes to put them back. */
  backupId: string;
  files: string[];
  /** The subset that changed since HarnessTap wrote it (--force-remove). Files HarnessTap did not write are never replaced. */
  notWrittenByHarnessTap: string[];
  /** The subset the plugin no longer has, so they were removed, not replaced. */
  removed?: string[];
}

/**
 * Plugin files a host plugin refresh could not write because something
 * HarnessTap did not create is in the way: a folder at the file's path, or a
 * file or link where one of its folders goes. HarnessTap never removes or
 * writes through it, so the plugin there is incomplete.
 */
export interface BlockedHostPluginViewFiles {
  hostView: string;
  files: Array<{
    path: string;
    /** Path (inside the folder) of what is in the way. */
    blockedBy: string;
    kind: "folder" | "file" | "link";
  }>;
}

let forceReplace = false;
const blocked: BlockedHostPluginViewFiles[] = [];
const kept: KeptHostPluginViewFiles[] = [];
const replaced: ReplacedHostPluginViewFiles[] = [];

/**
 * `--force-remove`: a host plugin refresh also replaces files HarnessTap did
 * not write (after backing them up). Off by default, so those files are kept.
 */
export function setHostPluginViewForceReplace(force: boolean): void {
  forceReplace = force;
}

export function hostPluginViewForceReplace(): boolean {
  return forceReplace;
}

/** The latest refresh of a folder replaces what an earlier one in this process kept. */
export function recordKeptHostPluginViewFiles(entry: KeptHostPluginViewFiles): void {
  const index = kept.findIndex((existing) => existing.hostView === entry.hostView);
  // A second refresh of the folder in the same command sees the signature the
  // first one just stored; it is only a repeat when the first was one too.
  const earlier = index >= 0 ? kept.splice(index, 1)[0] : undefined;
  const alreadyReported =
    entry.alreadyReported === true && (earlier === undefined || earlier.alreadyReported === true);
  kept.push({ ...entry, alreadyReported });
}

export function recordReplacedHostPluginViewFiles(entry: ReplacedHostPluginViewFiles): void {
  replaced.push(entry);
}

/** Plugin files a refresh wrote where there was no file, by folder, so a summary counts them. */
const added = new Map<string, Set<string>>();

export function recordAddedHostPluginViewFiles(hostView: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const files = added.get(hostView) ?? new Set<string>();
  for (const path of paths) files.add(path);
  added.set(hostView, files);
}

/** The latest refresh of a folder replaces what an earlier one in this process found blocked. */
export function recordBlockedHostPluginViewFiles(entry: BlockedHostPluginViewFiles): void {
  const index = blocked.findIndex((existing) => existing.hostView === entry.hostView);
  if (index >= 0) blocked.splice(index, 1);
  if (entry.files.length > 0) blocked.push(entry);
}

/** Drain the plugin files host plugin refreshes could not write since the last call. */
export function takeBlockedHostPluginViewFiles(): BlockedHostPluginViewFiles[] {
  return blocked.splice(0, blocked.length);
}

/**
 * True when a host plugin refresh in this process kept, replaced, added or could
 * not write files. Added files count too, so settling drains them and one
 * command's count never leaks into the next one in the same process.
 */
export function hasHostPluginViewNotices(): boolean {
  return kept.length > 0 || replaced.length > 0 || blocked.length > 0 || added.size > 0;
}

/**
 * How many files the host plugin refreshes in this process replaced with the
 * plugin's version and how many they removed, so a summary can count them.
 */
export function hostPluginViewChangeCounts(): { replaced: number; removed: number; added: number } {
  let addedCount = 0;
  for (const files of added.values()) addedCount += files.size;
  let replacedCount = 0;
  let removedCount = 0;
  for (const entry of replaced) {
    const removedHere = entry.removed?.length ?? 0;
    removedCount += removedHere;
    replacedCount += entry.files.length - removedHere;
  }
  return { replaced: replacedCount, removed: removedCount, added: addedCount };
}

/** Drain the files replaced by host plugin refreshes since the last call. */
export function takeReplacedHostPluginViewFiles(): ReplacedHostPluginViewFiles[] {
  // The added files are counted in the same summary, so they drain together.
  added.clear();
  return replaced.splice(0, replaced.length);
}

/**
 * Home-relative paths of the kept files a host plugin notice will report in
 * this process (not the ones already reported last time). Peeks, never drains.
 */
export function pendingKeptHostPluginViewPaths(): string[] {
  return kept
    .filter((entry) => !entry.alreadyReported)
    .flatMap((entry) => {
      const root = entry.homeRoot.replace(/[\\/]+$/, "");
      const folder = entry.hostView.replace(/\\/g, "/");
      const prefix = `${root.replace(/\\/g, "/")}/`;
      if (!folder.startsWith(prefix)) return [];
      const rel = folder.slice(prefix.length).replace(/\/+$/, "");
      return entry.files.map((file) => `${rel}/${file.path.replace(/\\/g, "/")}`);
    });
}

/** Drain the files kept by host plugin refreshes since the last call. */
export function takeKeptHostPluginViewFiles(): KeptHostPluginViewFiles[] {
  return kept.splice(0, kept.length);
}

/** What the refreshes in this process kept or replaced, for `--format json`. */
export function hostPluginViewNoticesJson(): {
  kept_plugin_files?: Array<{ folder: string; path: string; reason: string; in_plugin: boolean }>;
  replaced_plugin_files?: Array<{
    folder: string;
    files: string[];
    not_written_by_harnesstap: string[];
    backup_id: string;
  }>;
  blocked_plugin_files?: Array<{ folder: string; path: string; blocked_by: string; kind: string }>;
} {
  const out: ReturnType<typeof hostPluginViewNoticesJson> = {};
  if (kept.length > 0) {
    out.kept_plugin_files = kept.flatMap((entry) =>
      entry.files.map((file) => ({
        folder: entry.hostView,
        path: file.path,
        reason: file.reason === "modified" ? "changed_since_written" : "not_written_by_harnesstap",
        in_plugin: file.inPlugin !== false,
      })),
    );
  }
  if (replaced.length > 0) {
    out.replaced_plugin_files = replaced.map((entry) => ({
      folder: entry.hostView,
      files: entry.files,
      not_written_by_harnesstap: entry.notWrittenByHarnessTap,
      backup_id: entry.backupId,
    }));
  }
  if (blocked.length > 0) {
    out.blocked_plugin_files = blocked.flatMap((entry) =>
      entry.files.map((file) => ({
        folder: entry.hostView,
        path: file.path,
        blocked_by: file.blockedBy,
        kind: file.kind,
      })),
    );
  }
  return out;
}
