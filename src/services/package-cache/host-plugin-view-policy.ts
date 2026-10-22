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
  /** The subset HarnessTap did not write or that changed since (--force-remove). */
  notWrittenByHarnessTap: string[];
  /** The subset the plugin no longer has, so they were removed, not replaced. */
  removed?: string[];
}

let forceReplace = false;
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

/** True when a host plugin refresh in this process kept or replaced files. */
export function hasHostPluginViewNotices(): boolean {
  return kept.length > 0 || replaced.length > 0;
}

/**
 * How many files the host plugin refreshes in this process replaced with the
 * plugin's version and how many they removed, so a summary can count them.
 */
export function hostPluginViewChangeCounts(): { replaced: number; removed: number } {
  let replacedCount = 0;
  let removedCount = 0;
  for (const entry of replaced) {
    const removedHere = entry.removed?.length ?? 0;
    removedCount += removedHere;
    replacedCount += entry.files.length - removedHere;
  }
  return { replaced: replacedCount, removed: removedCount };
}

/** Drain the files replaced by host plugin refreshes since the last call. */
export function takeReplacedHostPluginViewFiles(): ReplacedHostPluginViewFiles[] {
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
  return out;
}
