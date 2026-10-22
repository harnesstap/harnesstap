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
  files: Array<{ path: string; reason: KeptHostPluginViewReason }>;
}

let forceReplace = false;
const kept: KeptHostPluginViewFiles[] = [];

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
  if (index >= 0) kept.splice(index, 1);
  kept.push(entry);
}

export function hasKeptHostPluginViewFiles(): boolean {
  return kept.length > 0;
}

/** Drain the files kept by host plugin refreshes since the last call. */
export function takeKeptHostPluginViewFiles(): KeptHostPluginViewFiles[] {
  return kept.splice(0, kept.length);
}
