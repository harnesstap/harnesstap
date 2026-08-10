import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyToGlobal,
  generateFiles,
  materializeFiles,
  removeGlobalMaterializedFiles,
  type ConflictPolicy,
  type ConflictResolution,
  type MaterializationConflict,
} from "./applier.js";
import {
  getLayerById,
  getLayerByPublishedIdentity,
  mergeLayersById,
  resolveLayerSelector,
} from "../models/plugin-model.js";
import type { Layer } from "../types.js";
import {
  createGlobalApplySnapshot,
  getLatestGlobalApplySnapshotForProfile,
  listGlobalApplySnapshotInstalls,
  listGlobalApplySnapshots,
  recordGlobalApplySnapshotInstall,
} from "../models/global-apply-snapshot.js";
import { getHarnessPreference } from "../models/harness.js";
import { getEnvironment } from "../models/environment.js";
import { getHarnesstapDir } from "../db/connection.js";
import {
  CLEARED_GLOBAL_PROFILE_LAYER_ID,
  CLEARED_GLOBAL_PROFILE_NAME,
  isEmptyBuiltinProfile,
  isProfileLayer,
} from "../constants/profile.js";
import { resolveEnvironmentCascadeForApply } from "./environment-cascade.js";
import {
  collectOtherProfilesSnapshotTrackedFiles,
  planStaleGlobalProfileFiles,
} from "./global-profile-cleanup.js";
import { substituteResourcesForApply } from "./environment-var-substitution.js";
import { preparePluginPinsForApply, collectPluginPinsForPrepare } from "./plugin-pin-apply.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  uniqueHarnessTargets,
} from "./harness-targets.js";
import { detectPlatforms } from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { getActiveProfileName } from "./active-profile.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import {
  listAttachedLayerRefs,
  listAttachedPluginPins,
} from "./layer-composition.js";
import { parseLayerSelector, resolveRemoteLayerSelector } from "./layer-selector.js";
import { resolveComposition } from "./resolve/index.js";
import type { ResolutionResult } from "./resolve/types.js";
import { ui } from "../ui/index.js";

export interface ApplyProfileLayerOptions {
  harness?: string;
  conflictPolicy: ConflictPolicy;
  conflictResolver?: (
    conflict: MaterializationConflict,
  ) => Promise<ConflictResolution> | ConflictResolution;
  dryRun?: boolean;
  pull?: boolean;
  account?: string;
  baseUrl?: string;
}

export interface ApplyProfileLayerResult {
  profile_name: string;
  profile_layer_id: string;
  configured_layer_ids: string[];
  harnesses: string[];
  dry_run: boolean;
  snapshot_id?: string;
  cancelled: boolean;
  files: string[];
  written_files: string[];
  skipped_files: string[];
  conflicts: string[];
  default_environment_name?: string;
  pulled_layers?: Array<{ layer_name: string; source: string }>;
  expected_files?: Array<{ path: string; content: string }>;
  removed_files?: string[];
}

function collectProfileSnapshotTrackedFiles(profileName: string): string[] {
  const snapshot = getLatestGlobalApplySnapshotForProfile(profileName);
  if (!snapshot) {
    return [];
  }
  return [
    ...new Set(
      listGlobalApplySnapshotInstalls(snapshot.id).flatMap(
        (install) => install.files,
      ),
    ),
  ];
}

function collectPreviousGlobalApplyTrackedFiles(): string[] {
  const [previousSnapshot] = listGlobalApplySnapshots();
  if (!previousSnapshot) {
    return [];
  }
  return collectProfileSnapshotTrackedFiles(previousSnapshot.profile_name);
}

async function collectOutgoingProfileFilesForCleanup(
  outgoingProfileName: string,
  incomingProfileName: string,
  options: Pick<ApplyProfileLayerOptions, "harness" | "pull">,
): Promise<string[]> {
  if (outgoingProfileName === incomingProfileName) {
    return collectProfileSnapshotTrackedFiles(outgoingProfileName);
  }

  const fromSnapshot = collectProfileSnapshotTrackedFiles(outgoingProfileName);
  const outgoingApply = await applyProfileLayer(outgoingProfileName, {
    dryRun: true,
    harness: options.harness,
    conflictPolicy: "replace",
    pull: options.pull ?? false,
  });

  return [...new Set([...fromSnapshot, ...outgoingApply.files])];
}

async function resolvePreviousTrackedFilesForApply(
  incomingProfileName: string,
  options: Pick<ApplyProfileLayerOptions, "harness" | "pull">,
): Promise<string[]> {
  const outgoingProfile = getActiveProfileName();
  const tracked = new Set<string>();

  if (outgoingProfile && outgoingProfile !== incomingProfileName) {
    for (const filePath of await collectOutgoingProfileFilesForCleanup(
      outgoingProfile,
      incomingProfileName,
      options,
    )) {
      tracked.add(filePath);
    }
  } else if (outgoingProfile) {
    for (const filePath of collectProfileSnapshotTrackedFiles(outgoingProfile)) {
      tracked.add(filePath);
    }
  }

  for (const filePath of collectOtherProfilesSnapshotTrackedFiles(incomingProfileName)) {
    tracked.add(filePath);
  }

  if (tracked.size > 0) {
    return [...tracked];
  }

  return collectPreviousGlobalApplyTrackedFiles();
}

function removeStaleGlobalProfileFiles(
  homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  harnesses: string[],
): string[] {
  const staleFiles = planStaleGlobalProfileFiles(
    homeRoot,
    desiredFiles,
    previousTrackedFiles,
    harnesses,
  );
  if (staleFiles.length > 0) {
    removeGlobalMaterializedFiles(homeRoot, staleFiles);
  }
  return staleFiles;
}

function normalizeVersionConstraint(versionConstraint: string): string | undefined {
  const trimmed = versionConstraint.trim();
  if (!trimmed || trimmed === "*" || trimmed === "latest") {
    return undefined;
  }
  return trimmed;
}

function resolveDependencyLayer(ref: {
  dependency_name: string;
  version_constraint: string;
}): Layer | undefined {
  try {
    const parsed = parseLayerSelector(ref.dependency_name);
    if (parsed.scope === "published") {
      const version = normalizeVersionConstraint(ref.version_constraint) ?? parsed.version;
      if (version) {
        const byPublishedIdentity = getLayerByPublishedIdentity({
          name: parsed.name,
          version,
          org: parsed.org,
          catalog: parsed.catalog,
        });
        if (byPublishedIdentity) {
          return byPublishedIdentity;
        }
      }
    }
  } catch {
    // Fall back to local selector resolution below.
  }

  const versionConstraint = normalizeVersionConstraint(ref.version_constraint);
  if (versionConstraint) {
    const withVersion = resolveLayerSelector(
      `${ref.dependency_name}@${versionConstraint}`,
    );
    if (withVersion) {
      return withVersion;
    }
  }
  return resolveLayerSelector(ref.dependency_name);
}

async function ensureProfileDependenciesAvailable(
  profileLayer: Layer,
  options: ApplyProfileLayerOptions,
): Promise<Array<{ layer_name: string; source: string }>> {
  const pulledLayers: Array<{ layer_name: string; source: string }> = [];
  const queue: Layer[] = [profileLayer];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const layer = queue.shift();
    if (!layer || visited.has(layer.id)) {
      continue;
    }
    visited.add(layer.id);

    for (const ref of listAttachedLayerRefs(layer.id)) {
      const localDependency = resolveDependencyLayer(ref);
      if (localDependency) {
        queue.push(localDependency);
        continue;
      }

      let parsed: ReturnType<typeof parseLayerSelector>;
      try {
        parsed = parseLayerSelector(ref.dependency_name);
      } catch {
        throw new Error(
          `Missing local layer dependency "${ref.dependency_name}" referenced by profile "${layer.name}"`,
        );
      }

      if (parsed.scope !== "published") {
        throw new Error(
          `Missing local layer dependency "${ref.dependency_name}" referenced by profile "${layer.name}"`,
        );
      }

      if (options.pull === false) {
        throw new Error(
          `Missing published dependency "${ref.dependency_name}" for profile "${layer.name}". Re-run without --no-pull.`,
        );
      }

      const remoteSelector = resolveRemoteLayerSelector(ref.dependency_name, {
        version: normalizeVersionConstraint(ref.version_constraint),
      });
      const installed = await installLayerFromCatalog(remoteSelector, {
        account: options.account,
        baseUrl: options.baseUrl,
      });
      pulledLayers.push({
        layer_name: installed.layerName,
        source: installed.sourceLabel,
      });
      const resolvedInstalled = getLayerById(installed.layerId);
      if (resolvedInstalled) {
        queue.push(resolvedInstalled);
      }
    }
  }

  return pulledLayers;
}

export function collectProfileLayerIds(profileLayer: Layer): string[] {
  const orderedIds: string[] = [];
  const queue: Layer[] = [profileLayer];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const layer = queue.shift();
    if (!layer || visited.has(layer.id)) {
      continue;
    }
    visited.add(layer.id);
    orderedIds.push(layer.id);

    for (const ref of listAttachedLayerRefs(layer.id)) {
      const resolved = resolveDependencyLayer(ref);
      if (!resolved) {
        throw new Error(
          `Missing local layer dependency "${ref.dependency_name}" referenced by profile "${layer.name}"`,
        );
      }
      queue.push(resolved);
    }
  }

  return orderedIds;
}

function listResolvedPluginPins(
  resolution: ResolutionResult,
): Array<{ ref: string; version_constraint: string }> {
  const pins = new Map<string, { ref: string; version_constraint: string }>();
  // Deeper layers first so nearer ones overwrite, matching Pass 2.
  const ordered = [...resolution.selected].sort(
    (a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex,
  );
  for (const plugin of ordered) {
    for (const pin of listAttachedPluginPins(plugin.layerId)) {
      pins.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }
  }
  return [...pins.values()];
}

function resolveGlobalApplyHarnessTargets(harnessOption?: string): string[] {
  const explicitTargets = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  return uniqueHarnessTargets(detectPlatforms(resolveHomeRoot()));
}

function writeHomeActiveEnvironment(name: string): string {
  const home = getHarnesstapDir();
  mkdirSync(home, { recursive: true });
  const filePath = join(home, "active-environment.json");
  writeFileSync(filePath, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8");
  return filePath;
}

export class ProfileEmptyProfileRemovedError extends Error {
  constructor() {
    super(
      'Profile "empty" is no longer available. Use "profile stash" to save the active profile and clear global harness files.',
    );
    this.name = "ProfileEmptyProfileRemovedError";
  }
}

export async function clearGlobalProfileApply(
  options: ApplyProfileLayerOptions,
): Promise<ApplyProfileLayerResult> {
  const harnesses = resolveGlobalApplyHarnessTargets(options.harness);
  const homeRoot = resolveHomeRoot();
  const previousTrackedFiles = await resolvePreviousTrackedFilesForApply(
    CLEARED_GLOBAL_PROFILE_NAME,
    options,
  );
  const removedFiles = planStaleGlobalProfileFiles(
    homeRoot,
    [],
    previousTrackedFiles,
    harnesses,
  );

  if (options.dryRun) {
    return {
      profile_name: CLEARED_GLOBAL_PROFILE_NAME,
      profile_layer_id: CLEARED_GLOBAL_PROFILE_LAYER_ID,
      configured_layer_ids: [],
      harnesses,
      dry_run: true,
      cancelled: false,
      files: [],
      written_files: [],
      skipped_files: [],
      conflicts: [],
      expected_files: [],
      ...(removedFiles.length > 0 ? { removed_files: removedFiles } : {}),
    };
  }

  if (removedFiles.length > 0) {
    removeGlobalMaterializedFiles(homeRoot, removedFiles);
  }

  const snapshot = createGlobalApplySnapshot({
    profile_name: CLEARED_GLOBAL_PROFILE_NAME,
    layer_ids: [],
  });

  return {
    profile_name: CLEARED_GLOBAL_PROFILE_NAME,
    profile_layer_id: CLEARED_GLOBAL_PROFILE_LAYER_ID,
    configured_layer_ids: [],
    harnesses,
    dry_run: false,
    snapshot_id: snapshot.id,
    cancelled: false,
    files: [],
    written_files: [],
    skipped_files: [],
    conflicts: [],
    ...(removedFiles.length > 0 ? { removed_files: removedFiles } : {}),
  };
}

export async function applyProfileLayer(
  selector: string,
  options: ApplyProfileLayerOptions,
): Promise<ApplyProfileLayerResult> {
  if (isEmptyBuiltinProfile(selector)) {
    throw new ProfileEmptyProfileRemovedError();
  }

  const profileLayer = resolveLayerSelector(selector);
  if (!profileLayer) {
    throw new Error(`Layer not found: ${selector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }

  const pulledLayers = await ensureProfileDependenciesAvailable(
    profileLayer,
    options,
  );
  const homeRoot = resolveHomeRoot();
  const rootPluginPins = collectPluginPinsForPrepare([profileLayer.id]);
  const skipPluginSync = options.dryRun || rootPluginPins.length === 0;

  // Marketplace/git pins on the profile root must be materialized before the
  // first composition resolve can walk them as upstream layers.
  await preparePluginPinsForApply({
    pins: rootPluginPins,
    baseResources: [],
    projectRoot: homeRoot,
    claudeConfig: mergeLayersById([profileLayer.id]).claude,
    scope: "user",
    skipSync: skipPluginSync,
  });

  let resolution = resolveComposition({ rootSelectors: [profileLayer.name] });
  let merged = {
    layers: resolution.selected
      .map((plugin) => getLayerById(plugin.layerId))
      .filter((layer): layer is NonNullable<typeof layer> => layer != null),
    resources: resolution.resources,
    claude: mergeLayersById(
      [...resolution.selected]
        .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
        .map((plugin) => plugin.layerId),
    ).claude,
    pluginPins: listResolvedPluginPins(resolution),
  };
  for (const warning of resolution.warnings) {
    console.warn(ui.theme.warn(warning));
  }
  const configuredLayerIds = merged.layers.map((layer) => layer.id);
  const resolvedSet = resolution.selected
    .filter((plugin) => plugin.depth > 0)
    .map((plugin) => ({ name: plugin.name, version: plugin.version }));
  const harnesses = resolveGlobalApplyHarnessTargets(options.harness);
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredLayerIds,
  });

  let defaultEnvironmentName: string | undefined;
  if (profileLayer.default_environment_id) {
    const environment = getEnvironment(profileLayer.default_environment_id);
    if (!environment) {
      throw new Error(
        `Default environment ${profileLayer.default_environment_id} not found for profile ${profileLayer.name}`,
      );
    }
    defaultEnvironmentName = environment.name;
  }

  const rootPinRefs = new Set(rootPluginPins.map((pin) => pin.ref));
  const additionalPins = collectPluginPinsForPrepare(configuredLayerIds).filter(
    (pin) => !rootPinRefs.has(pin.ref),
  );
  if (!options.dryRun && additionalPins.length > 0) {
    const additionalPrepare = await preparePluginPinsForApply({
      pins: additionalPins,
      baseResources: merged.resources,
      projectRoot: homeRoot,
      claudeConfig: merged.claude,
      scope: "user",
      skipSync: false,
    });
    if (
      additionalPrepare.installs.some(
        (install) => install.status !== "already_installed",
      )
    ) {
      resolution = resolveComposition({ rootSelectors: [profileLayer.name] });
      merged = {
        layers: resolution.selected
          .map((plugin) => getLayerById(plugin.layerId))
          .filter((layer): layer is NonNullable<typeof layer> => layer != null),
        resources: resolution.resources,
        claude: mergeLayersById(
          [...resolution.selected]
            .sort((a, b) => b.depth - a.depth || b.declarationIndex - a.declarationIndex)
            .map((plugin) => plugin.layerId),
        ).claude,
        pluginPins: listResolvedPluginPins(resolution),
      };
    }
  }

  const resolvedResources = merged.resources;
  let applyResources = substituteResourcesForApply(
    resolvedResources,
    resolvedEnvironment.vars,
  ).resources;

  if (options.dryRun) {
    const previousTrackedFiles = await resolvePreviousTrackedFilesForApply(
      profileLayer.name,
      options,
    );
    const generated = await generateFiles(applyResources, harnesses, homeRoot, {
      target: "global",
      claudeConfig: merged.claude,
      resolvedEnvironment,
    });
    const files = generated.flatMap((result) => result.files);
    const materialized = await materializeFiles(files, homeRoot, {
      conflictPolicy: options.conflictPolicy,
      conflictResolver: options.conflictResolver,
      dryRun: true,
    });
    const desiredFiles = files.map((file) => file.path);
    const removedFiles = planStaleGlobalProfileFiles(
      homeRoot,
      desiredFiles,
      previousTrackedFiles,
      harnesses,
    );
    return {
      profile_name: profileLayer.name,
      profile_layer_id: profileLayer.id,
      configured_layer_ids: configuredLayerIds,
      harnesses,
      dry_run: true,
      cancelled: materialized.cancelled,
      files: files.map((file) => file.path),
      written_files: materialized.writtenFiles,
      skipped_files: materialized.skippedFiles,
      conflicts: materialized.conflicts.map((conflict) => conflict.path),
      expected_files: files.map((file) => ({ path: file.path, content: file.content })),
      ...(defaultEnvironmentName ? { default_environment_name: defaultEnvironmentName } : {}),
      ...(pulledLayers.length > 0 ? { pulled_layers: pulledLayers } : {}),
      ...(removedFiles.length > 0 ? { removed_files: removedFiles } : {}),
    };
  }

  const previousTrackedFiles = await resolvePreviousTrackedFilesForApply(
    profileLayer.name,
    options,
  );
  const applied = await applyToGlobal(applyResources, harnesses, homeRoot, {
    conflictPolicy: options.conflictPolicy,
    conflictResolver: options.conflictResolver,
    resolvedEnvironment,
    claudeConfig: merged.claude,
  });
  let snapshotId: string | undefined;
  let removedFiles: string[] = [];
  if (!applied.cancelled) {
    removedFiles = removeStaleGlobalProfileFiles(
      homeRoot,
      applied.results.flatMap((result) => result.files.map((file) => file.path)),
      previousTrackedFiles,
      harnesses,
    );
    const snapshot = createGlobalApplySnapshot({
      profile_name: profileLayer.name,
      layer_ids: configuredLayerIds,
      resolved_set: resolvedSet,
    });
    snapshotId = snapshot.id;
    for (const result of applied.results) {
      const installFiles = result.files.map((file) => file.path);
      if (installFiles.length === 0) continue;
      recordGlobalApplySnapshotInstall({
        snapshot_id: snapshot.id,
        platform_id: result.platformId,
        files: installFiles,
      });
    }
  }
  if (!applied.cancelled && defaultEnvironmentName) {
    writeHomeActiveEnvironment(defaultEnvironmentName);
  }

  return {
    profile_name: profileLayer.name,
    profile_layer_id: profileLayer.id,
    configured_layer_ids: configuredLayerIds,
    harnesses,
    dry_run: false,
    ...(snapshotId ? { snapshot_id: snapshotId } : {}),
    cancelled: applied.cancelled,
    files: applied.results.flatMap((result) => result.files.map((file) => file.path)),
    written_files: applied.writtenFiles,
    skipped_files: applied.skippedFiles,
    conflicts: applied.conflicts.map((conflict) => conflict.path),
    ...(defaultEnvironmentName ? { default_environment_name: defaultEnvironmentName } : {}),
    ...(pulledLayers.length > 0 ? { pulled_layers: pulledLayers } : {}),
    ...(removedFiles.length > 0 ? { removed_files: removedFiles } : {}),
  };
}
