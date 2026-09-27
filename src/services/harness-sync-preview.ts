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

function resourceWouldChange(
  planned: ResourceCreateInput,
  current: Map<string, ResourceCreateInput>,
): boolean {
  const existing = current.get(resourceIdentity(planned));
  if (!existing) return true;
  return resourceFingerprint(existing) !== resourceFingerprint(planned);
}

/**
 * Count resources that would be added or updated on each harness.
 *
 * One `type:name:namespace` is one change, matching inventory rows. Host
 * plugin pins count as a single resource on Claude/Cursor; portable harnesses
 * get extracted plugin skills/resources instead of those pin trees.
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
    const seen = new Set<string>();
    let changes = 0;

    const consider = (resource: ResourceCreateInput): void => {
      if (isClaudeLocalMcpResource(resource)) return;
      if (portable && isHostPluginPin(resource)) return;
      const identity = resourceIdentity(resource);
      if (seen.has(identity)) return;
      seen.add(identity);
      if (resourceWouldChange(resource, current)) changes += 1;
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
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (!skillNames.has(skill.name)) changes += 1;
      }
    }

    return { harness, changes };
  });
}
