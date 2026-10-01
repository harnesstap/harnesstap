import type { ResourceCreateInput } from "../types.js";
import { isClaudeLocalMcpResource } from "./claude-local-mcp.js";
import {
  type HarnessScanSlice,
  resourceFingerprint,
} from "./harness-resource-union.js";
import {
  type ExtractHostPluginMaterialResult,
  isHostPluginTreePlatform,
} from "./host-plugin-material.js";
import { isHostPluginPinResource } from "./host-plugin-serialize.js";
import { resourceIdentity } from "./reference-resources.js";

export interface HarnessSyncChangeCount {
  harness: string;
  changes: number;
  added: number;
  removed: number;
  modified: number;
}

export interface CountHarnessSyncChangesInput {
  platforms: readonly string[];
  slices: readonly HarnessScanSlice[];
  unionResources: readonly ResourceCreateInput[];
  extracted: ExtractHostPluginMaterialResult;
}

function isHostPluginPin(resource: ResourceCreateInput): boolean {
  return isHostPluginPinResource({
    type: resource.type,
    metadata: resource.metadata,
    origin_ref: resource.origin_ref ?? "",
  });
}

function sliceByIdentity(
  slice: HarnessScanSlice | undefined,
): Map<string, ResourceCreateInput> {
  const byIdentity = new Map<string, ResourceCreateInput>();
  if (!slice) return byIdentity;
  for (const resource of slice.resources) {
    byIdentity.set(resourceIdentity(resource), resource);
  }
  return byIdentity;
}

function sliceSkillNames(slice: HarnessScanSlice | undefined): Set<string> {
  const names = new Set<string>();
  if (!slice) return names;
  for (const resource of slice.resources) {
    if (resource.type === "skill") names.add(resource.name);
  }
  return names;
}

function skipPreviewResource(
  resource: ResourceCreateInput,
  portable: boolean,
): boolean {
  if (isClaudeLocalMcpResource(resource)) return true;
  if (portable && isHostPluginPin(resource)) return true;
  return false;
}

/**
 * Count resources that would be added, removed, or updated on each harness.
 *
 * One `type:name:namespace` is one change, matching inventory rows. Host
 * plugin pins count as a single resource on Claude/Cursor; portable harnesses
 * get extracted plugin skills/resources instead of those pin trees.
 * `changes` is added + removed + modified.
 */
export function countHarnessSyncChanges(
  input: CountHarnessSyncChangesInput,
): HarnessSyncChangeCount[] {
  const slices = new Map(
    input.slices.map((slice) => [slice.platformId, slice]),
  );

  return input.platforms.map((harness) => {
    const slice = slices.get(harness);
    const current = sliceByIdentity(slice);
    const skillNames = sliceSkillNames(slice);
    const portable = !isHostPluginTreePlatform(harness);
    const planned = new Set<string>();
    let added = 0;
    let modified = 0;
    let removed = 0;

    const consider = (resource: ResourceCreateInput): void => {
      if (skipPreviewResource(resource, portable)) return;
      const identity = resourceIdentity(resource);
      if (planned.has(identity)) return;
      planned.add(identity);
      const existing = current.get(identity);
      if (!existing) {
        added += 1;
        return;
      }
      if (resourceFingerprint(existing) !== resourceFingerprint(resource)) {
        modified += 1;
      }
    };

    for (const resource of input.unionResources) {
      consider(resource);
    }

    if (portable) {
      for (const resource of input.extracted.resources) {
        consider(resource);
      }
      for (const skill of input.extracted.skills) {
        const identity = `skill:${skill.name}:`;
        if (planned.has(identity)) continue;
        planned.add(identity);
        if (!skillNames.has(skill.name)) added += 1;
      }
    }

    for (const [identity, resource] of current) {
      if (skipPreviewResource(resource, portable)) continue;
      if (!planned.has(identity)) removed += 1;
    }

    return {
      harness,
      added,
      removed,
      modified,
      changes: added + removed + modified,
    };
  });
}
