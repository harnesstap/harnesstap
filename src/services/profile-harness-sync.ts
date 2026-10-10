import {
  addResourceToPlugin,
  getPluginResources,
  removeResourceFromPlugin,
  resolvePluginSelector,
  touchPluginUpdatedAt,
} from "../models/plugin-model.js";
import { getHarnessPreference } from "../models/harness.js";
import { isProfilePlugin } from "../constants/profile.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type MaterialResourceType,
  type Resource,
  type ResourceCreateInput,
} from "../types.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { collectProfilePluginIds } from "./profile-apply.js";
import {
  detectHomePlatforms,
  persistScanResults,
  scanHomeDefaults,
} from "./scanner.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  registeredHarnessesOf,
  uniqueHarnessTargets,
} from "./harness-targets.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { diskCaptureHarnessScope } from "./harness-scope.js";
import { getActiveProfileName } from "./active-profile.js";

export interface ProfileHarnessSyncChange {
  resource_type: string;
  resource_name: string;
  change: "added" | "removed" | "modified";
}

export interface ProfileHarnessSyncStatus {
  active_profile: string;
  registered_harnesses: string[];
  in_sync: boolean;
  changes: ProfileHarnessSyncChange[];
  warning?: string;
}

export interface UpdateProfileFromHarnessResult {
  profile_name: string;
  registered_harnesses: string[];
  attached_resources: number;
  removed_resources: number;
  updated_resources: number;
}

const MATERIAL_RESOURCE_TYPE_SET = new Set<string>(MATERIAL_RESOURCE_TYPES);

function isMaterialResource(
  resource: Pick<Resource, "type"> | Pick<ResourceCreateInput, "type">,
): resource is Resource & { type: MaterialResourceType } {
  return MATERIAL_RESOURCE_TYPE_SET.has(resource.type);
}

function profileResourceKey(
  resource: Pick<Resource, "type" | "name"> | Pick<ResourceCreateInput, "type" | "name">,
): string {
  return `${resource.type}:${resource.name}`;
}

export function resolveRegisteredScanTargets(
  harnessOption?: string,
  homeRoot = resolveHomeRoot(),
): string[] {
  const explicitTargets = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const registered = registeredHarnessesOf(getHarnessPreference());
  if (registered.length > 0) {
    assertSupportedHarnessTargets(registered);
    return registered;
  }

  const detected = detectHomePlatforms(homeRoot).map((entry) => entry.platformId);
  if (detected.length === 0) {
    throw new Error(
      "No harnesses configured. Run ht harness set or pass --harness <slugs>.",
    );
  }
  return detected;
}

/** First registered or explicit target. Prefer `resolveRegisteredScanTargets`. */
export function resolveMainHarnessTarget(
  harnessOption?: string,
  homeRoot = resolveHomeRoot(),
): string {
  const [first] = resolveRegisteredScanTargets(harnessOption, homeRoot);
  if (!first) {
    throw new Error("No harness targets provided.");
  }
  return first;
}

function compareMaterialResources(
  profileResources: Resource[],
  harnessResources: ResourceCreateInput[],
): ProfileHarnessSyncChange[] {
  const profileMap = new Map(
    profileResources
      .filter(isMaterialResource)
      .map((resource) => [profileResourceKey(resource), resource] as const),
  );
  const harnessMap = new Map(
    harnessResources
      .filter(isMaterialResource)
      .map((resource) => [profileResourceKey(resource), resource] as const),
  );

  const changes: ProfileHarnessSyncChange[] = [];
  for (const [key, harnessResource] of harnessMap) {
    const profileResource = profileMap.get(key);
    if (!profileResource) {
      changes.push({
        resource_type: harnessResource.type,
        resource_name: harnessResource.name,
        change: "added",
      });
      continue;
    }
    if (profileResource.content !== harnessResource.content) {
      changes.push({
        resource_type: harnessResource.type,
        resource_name: harnessResource.name,
        change: "modified",
      });
    }
  }

  for (const [key, profileResource] of profileMap) {
    if (!harnessMap.has(key)) {
      changes.push({
        resource_type: profileResource.type,
        resource_name: profileResource.name,
        change: "removed",
      });
    }
  }

  return changes;
}

async function scanRegisteredHome(harnessOption?: string) {
  const targets = resolveRegisteredScanTargets(harnessOption);
  const homeRoot = resolveHomeRoot();
  const scanned = await scanHomeDefaults(undefined, homeRoot);
  const wanted = new Set(targets);
  const filtered = scanned.filter((result) => wanted.has(result.platformId));
  return { targets, scanned: filtered.length > 0 ? filtered : scanned };
}

export async function detectProfileHarnessSyncStatus(input: {
  profileSelector: string;
  harness?: string;
}): Promise<ProfileHarnessSyncStatus> {
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
  }

  const { targets, scanned } = await scanRegisteredHome(input.harness);
  let profileResources: Resource[];
  try {
    profileResources = mergePluginsForApply(
      collectProfilePluginIds(profilePlugin),
    ).resources;
  } catch (error) {
    return {
      active_profile: profilePlugin.name,
      registered_harnesses: targets,
      in_sync: false,
      changes: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  const harnessResources = scanned.flatMap((result) => result.resources);
  const changes = compareMaterialResources(profileResources, harnessResources);

  return {
    active_profile: profilePlugin.name,
    registered_harnesses: targets,
    in_sync: changes.length === 0,
    changes,
  };
}

export async function updateProfileFromMainHarness(input: {
  profileSelector: string;
  harness?: string;
}): Promise<UpdateProfileFromHarnessResult> {
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
  }

  const { targets, scanned } = await scanRegisteredHome(input.harness);
  const beforeSync = getPluginResources(profilePlugin.id).filter(isMaterialResource);
  const harnessResources = scanned.flatMap((result) => result.resources);
  const pendingChanges = compareMaterialResources(beforeSync, harnessResources);
  const homeRoot = resolveHomeRoot();
  const persisted = persistScanResults(scanned, {
    conflictPolicy: "overwrite",
    originRef: homeRoot,
  });
  const scannedResources = persisted.resolved.filter(isMaterialResource);
  const scannedKeys = new Set(scannedResources.map((resource) => profileResourceKey(resource)));

  let removedResources = 0;
  for (const resource of beforeSync) {
    if (!scannedKeys.has(profileResourceKey(resource))) {
      removeResourceFromPlugin(profilePlugin.id, resource.id);
      removedResources += 1;
    }
  }

  let attachedResources = 0;
  for (const resource of scannedResources) {
    const existingAttachment = beforeSync.some(
      (attached) => attached.id === resource.id,
    );
    addResourceToPlugin(
      profilePlugin.id,
      resource.id,
      diskCaptureHarnessScope(resource),
    );
    if (!existingAttachment) {
      attachedResources += 1;
    }
  }

  touchPluginUpdatedAt(profilePlugin.id);

  return {
    profile_name: profilePlugin.name,
    registered_harnesses: targets,
    attached_resources: attachedResources,
    removed_resources: removedResources,
    updated_resources: pendingChanges.filter((change) => change.change === "modified").length,
  };
}

export async function detectActiveProfileHarnessSyncBeforeSwitch(input: {
  targetProfileName: string;
  harness?: string;
}): Promise<ProfileHarnessSyncStatus | null> {
  const activeProfile = getActiveProfileName();
  if (!activeProfile || activeProfile === input.targetProfileName) {
    return null;
  }

  return detectProfileHarnessSyncStatus({
    profileSelector: activeProfile,
    harness: input.harness,
  });
}
