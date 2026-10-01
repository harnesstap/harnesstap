import type {
  HarnessSettingsProject,
  MaterializationStrategy,
} from "./types";

export function visibleHarnesses<T extends { id: string; supported: boolean }>(
  harnesses: T[],
  options: { showAll: boolean; selectedIds: string[] },
): T[] {
  if (options.showAll) return harnesses;
  const selected = new Set(options.selectedIds);
  return harnesses.filter((h) => h.supported || selected.has(h.id));
}

const GENERIC_HARNESS_BASE =
  "Path-based mirroring (no dedicated serializer)";

export function genericHarnessTooltip(supports: string[]): string {
  if (supports.length === 0) {
    return GENERIC_HARNESS_BASE;
  }
  return `${GENERIC_HARNESS_BASE}. Supports ${supports.join(", ")}.`;
}

/** Settings → Project harness override. The global selection lives on the Harnesses destination. */
export interface ProjectHarnessOverrideDraft {
  override: boolean;
  registered: string[];
  materialization: MaterializationStrategy;
}

export const EMPTY_PROJECT_OVERRIDE_DRAFT: ProjectHarnessOverrideDraft = {
  override: false,
  registered: [],
  materialization: "symlink-preferred",
};

export function projectOverrideDraftFromPayload(
  project: HarnessSettingsProject | undefined,
): ProjectHarnessOverrideDraft {
  if (!project || project.override !== true) {
    return EMPTY_PROJECT_OVERRIDE_DRAFT;
  }
  return {
    override: true,
    registered: [...(project.registered_harnesses ?? [])],
    materialization: project.materialization_strategy ?? "symlink-preferred",
  };
}

export function isProjectOverrideDirty(
  baseline: ProjectHarnessOverrideDraft,
  draft: ProjectHarnessOverrideDraft,
): boolean {
  return (
    baseline.override !== draft.override
    || (draft.override
      && (baseline.registered.join("\0") !== draft.registered.join("\0")
        || baseline.materialization !== draft.materialization))
  );
}

export function canSaveProjectOverride(options: {
  dirty: boolean;
  busy: boolean;
  loading: boolean;
  disabled: boolean;
  baseUrl: string | null | undefined;
  projectPath: string | null;
  projectAvailable: boolean;
  globalRegistered: string[];
  override: boolean;
  registered: string[];
}): boolean {
  if (
    !options.dirty
    || options.busy
    || options.loading
    || options.disabled
    || !options.baseUrl
    || !options.projectPath
    || !options.projectAvailable
    || options.globalRegistered.length === 0
  ) {
    return false;
  }
  if (options.override && options.registered.length === 0) {
    return false;
  }
  return true;
}
