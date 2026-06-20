import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isProfileLayer } from "../constants/profile.js";
import { getLatestGlobalApplySnapshotForProfile } from "../models/global-apply-snapshot.js";
import { resolveLayerSelector } from "../models/layer-model.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { applyProfileLayer, type ApplyProfileLayerResult } from "./profile-apply.js";
import type { DriftFileChange } from "./project-drift.js";

export interface GlobalProfileStatus {
  active_profile: string | null;
  profile_exists: boolean;
  applied: boolean;
  snapshot_id: string | null;
  snapshot_at: string | null;
  stack_in_sync: boolean;
  has_drift: boolean;
  changes: DriftFileChange[];
  warning?: string;
}

function readGlobalFile(homeRoot: string, relativePath: string): string | null {
  const fullPath = join(homeRoot, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function layerIdsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((layerId, index) => layerId === right[index]);
}

export async function detectGlobalProfileStatus(input: {
  harness?: string;
} = {}): Promise<GlobalProfileStatus> {
  const activeProfile = getActiveProfileName() ?? null;
  if (!activeProfile) {
    return {
      active_profile: null,
      profile_exists: false,
      applied: false,
      snapshot_id: null,
      snapshot_at: null,
      stack_in_sync: false,
      has_drift: false,
      changes: [],
    };
  }

  const layer = resolveLayerSelector(activeProfile);
  if (!layer) {
    return {
      active_profile: activeProfile,
      profile_exists: false,
      applied: false,
      snapshot_id: null,
      snapshot_at: null,
      stack_in_sync: false,
      has_drift: true,
      changes: [],
      warning: `missing layer "${activeProfile}"`,
    };
  }

  if (!isProfileLayer(layer)) {
    return {
      active_profile: activeProfile,
      profile_exists: true,
      applied: false,
      snapshot_id: null,
      snapshot_at: null,
      stack_in_sync: false,
      has_drift: true,
      changes: [],
      warning: `layer "${layer.name}" is not tagged as a profile`,
    };
  }

  const latestSnapshot = getLatestGlobalApplySnapshotForProfile(activeProfile);
  const homeRoot = resolveHomeRoot();
  let expectedApply: ApplyProfileLayerResult;
  try {
    expectedApply = await applyProfileLayer(activeProfile, {
      dryRun: true,
      harness: input.harness,
      conflictPolicy: "replace",
      pull: false,
    });
  } catch (error) {
    return {
      active_profile: activeProfile,
      profile_exists: true,
      applied: Boolean(latestSnapshot),
      snapshot_id: latestSnapshot?.id ?? null,
      snapshot_at: latestSnapshot?.created_at ?? null,
      stack_in_sync: false,
      has_drift: true,
      changes: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  const stackInSync = latestSnapshot
    ? layerIdsMatch(latestSnapshot.layer_ids, expectedApply.configured_layer_ids)
    : false;

  const changes: DriftFileChange[] = [];
  for (const file of expectedApply.expected_files ?? []) {
    const current = readGlobalFile(homeRoot, file.path);
    if (current === null) {
      changes.push({ path: file.path, type: "deleted" });
      continue;
    }
    if (current !== file.content) {
      changes.push({ path: file.path, type: "modified" });
    }
  }

  const applied = Boolean(latestSnapshot);
  const hasDrift = !applied || !stackInSync || changes.length > 0;

  return {
    active_profile: activeProfile,
    profile_exists: true,
    applied,
    snapshot_id: latestSnapshot?.id ?? null,
    snapshot_at: latestSnapshot?.created_at ?? null,
    stack_in_sync: stackInSync,
    has_drift: hasDrift,
    changes,
  };
}
