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
} from "./harness-targets.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";

export interface ProfileHarnessSyncChange {
  resource_type: string;
  resource_name: string;
  change: "added" | "removed" | "modified";
}

export interface ProfileHarnessSyncStatus {
  active_profile: string;
  main_harness: string;
  in_sync: boolean;
  changes: ProfileHarnessSyncChange[];
  warning?: string;
}

export interface UpdateProfileFromHarnessResult {
  profile_name: string;
  main_harness: string;
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

export function resolveMainHarnessTarget(
  harnessOption?: string,
  homeRoot = resolveHomeRoot(),
): string {
  const explicitTargets = parsePlatformFilter(harnessOption) ?? [];
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    const preference = getHarnessPreference();
    if (
      explicitTargets.length > 1
      && preference
      && explicitTargets.includes(preference.main_harness)
    ) {
      return preference.main_harness;
    }
    const [firstTarget] = explicitTargets;
    if (!firstTarget) {
      throw new Error("No harness targets provided.");
    }
    return firstTarget;
  }

  const preference = getHarnessPreference();
  if (preference?.main_harness) {
    assertSupportedHarnessTargets([preference.main_harness]);
    return preference.main_harness;
  }

  const [detected] = detectHomePlatforms(homeRoot);
  if (!detected) {
    throw new Error(
      "No main harness detected. Run harnesstap harness set or pass --harness <slug>.",
    );
  }
  return detected.platformId;
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

  const mainHarness = resolveMainHarnessTarget(input.harness);
  let profileResources: Resource[];
  try {
    profileResources = mergePluginsForApply(
      collectProfilePluginIds(profilePlugin),
    ).resources;
  } catch (error) {
    return {
      active_profile: profilePlugin.name,
      main_harness: mainHarness,
      in_sync: false,
      changes: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  const scanned = await scanHomeDefaults(mainHarness);
  const harnessResources = scanned.flatMap((result) => result.resources);
  const changes = compareMaterialResources(profileResources, harnessResources);

  return {
    active_profile: profilePlugin.name,
    main_harness: mainHarness,
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

  const mainHarness = resolveMainHarnessTarget(input.harness);
  const beforeSync = getPluginResources(profilePlugin.id).filter(isMaterialResource);
  const scanned = await scanHomeDefaults(mainHarness);
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
    addResourceToPlugin(profilePlugin.id, resource.id);
    if (!existingAttachment) {
      attachedResources += 1;
    }
  }

  touchPluginUpdatedAt(profilePlugin.id);

  return {
    profile_name: profilePlugin.name,
    main_harness: mainHarness,
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
