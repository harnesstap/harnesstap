export function aliasesExcludingMain(aliases: string[], main: string): string[] {
  return aliases.filter((id) => id && id !== main);
}

export function visibleHarnesses<T extends { id: string; supported: boolean }>(
  harnesses: T[],
  options: { showAll: boolean; selectedIds: string[] },
): T[] {
  if (options.showAll) return harnesses;
  const selected = new Set(options.selectedIds);
  return harnesses.filter((h) => h.supported || selected.has(h.id));
}

export interface HarnessSettingsDraft {
  globalMain: string;
  globalAliases: string[];
  projectOverride: boolean;
  projectMain: string;
  projectAliases: string[];
  materialization: "symlink-preferred" | "copy";
}

export function isHarnessSettingsDirty(
  baseline: HarnessSettingsDraft,
  draft: HarnessSettingsDraft,
): boolean {
  return (
    baseline.globalMain !== draft.globalMain
    || baseline.globalAliases.join("\0") !== draft.globalAliases.join("\0")
    || baseline.projectOverride !== draft.projectOverride
    || (draft.projectOverride
      && (baseline.projectMain !== draft.projectMain
        || baseline.projectAliases.join("\0") !== draft.projectAliases.join("\0")
        || baseline.materialization !== draft.materialization))
  );
}

export function canSaveHarnessSettings(options: {
  dirty: boolean;
  busy: boolean;
  loading: boolean;
  disabled: boolean;
  globalMain: string;
  baseUrl: string | null | undefined;
  projectOverride: boolean;
  projectAvailable: boolean;
  projectMain: string;
}): boolean {
  if (
    !options.dirty
    || options.busy
    || options.loading
    || options.disabled
    || !options.globalMain
    || !options.baseUrl
  ) {
    return false;
  }
  if (options.projectOverride && options.projectAvailable && !options.projectMain) {
    return false;
  }
  return true;
}
