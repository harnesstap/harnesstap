import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadSettings } from "../config/settings.js";
import { getHarnesstapDir } from "../db/connection.js";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
} from "../models/harness.js";
import { upsertProject } from "../models/project.js";
import { createSnapshot } from "../models/snapshot.js";
import { captureManagedSnapshotState } from "./snapshot-capture.js";
import type {
  CursorSkillMode,
  ResourceCreateInput,
  SerializerTarget,
  SurfaceWarning,
} from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  type ApplyResult,
  generateFiles,
  materializeFiles,
  writeFiles,
} from "./applier.js";
import { getGitOrigin, normalizeGitUrl, projectNameFromUrl } from "./git.js";
import {
  toPortableEmitResources,
  type UnionConflict,
  unionHarnessResources,
} from "./harness-resource-union.js";
import {
  countHarnessSyncChanges,
  type HarnessSyncChangeCount,
} from "./harness-sync-preview.js";
import { uniqueHarnessTargets } from "./harness-targets.js";
import {
  extractHostPluginMaterial,
  type ExtractHostPluginMaterialResult,
  materializeSkillHubPlan,
  planPluginSkillHub,
  portableHarnessesForPluginFanout,
} from "./host-plugin-material.js";
import {
  applyInstructionLinks,
  pairInstructionFiles,
} from "./instruction-file-links.js";
import { persistWrittenMaterializations } from "./materialization-ownership.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import {
  DEFAULT_PLUGIN_RESOURCE_MODE,
  type PluginResourceMode,
} from "./plugin-resource-mode.js";
import { resourceIdentity } from "./reference-resources.js";
import {
  dropPluginTranslatedResources,
  writeHarnessSyncPluginTranslationMarkers,
} from "./plugin-translation-marker.js";
import {
  persistScanResults,
  scanPlatform,
} from "./scanner.js";
import {
  collectManagedSkillPlacements,
  flattenUniqueFiles,
  pinSkillEmitsToExistingLivePaths,
  preferSharedSkillEmits,
} from "./shared-emit-paths.js";

export type HarnessUnionSyncCode =
  | "no_registered_harnesses"
  | "need_two_harnesses";

export class HarnessUnionSyncError extends Error {
  readonly code: HarnessUnionSyncCode;

  constructor(code: HarnessUnionSyncCode, message: string) {
    super(message);
    this.name = "HarnessUnionSyncError";
    this.code = code;
  }
}

export interface SyncConfiguredHarnessesOptions {
  scope?: "global" | "project";
  projectRoot?: string;
  homeRoot?: string;
  dryRun?: boolean;
  pluginResourceMode?: PluginResourceMode;
}

export interface SyncConfiguredHarnessesResult {
  registered_harnesses: string[];
  conflict_policy: "last-write";
  platforms_synced: string[];
  files_written: number;
  harness_changes: HarnessSyncChangeCount[];
  conflicts: UnionConflict[];
  files: string[];
  plugin_resource_mode: PluginResourceMode;
  surface_warnings: SurfaceWarning[];
}

function resolvePluginResourceMode(
  override?: PluginResourceMode,
): PluginResourceMode {
  if (override) return override;
  try {
    return loadSettings(getHarnesstapDir()).harnessSync.pluginResources;
  } catch {
    return DEFAULT_PLUGIN_RESOURCE_MODE;
  }
}

function resolveConfiguredSelection(projectRoot?: string): {
  registered_harnesses: string[];
  cursor_skill_mode?: CursorSkillMode;
} {
  const global = getHarnessPreference();
  if (projectRoot) {
    const gitOrigin = getGitOrigin(projectRoot);
    if (gitOrigin) {
      const project = upsertProject({
        git_origin: normalizeGitUrl(gitOrigin),
        name: projectNameFromUrl(gitOrigin),
        local_path: projectRoot,
      });
      const projectConfig = getProjectHarnessConfig(project.id);
      const registered = uniqueHarnessTargets(
        projectConfig?.registered_harnesses ?? [],
      );
      if (registered.length > 0) {
        return {
          registered_harnesses: registered,
          ...(projectConfig?.cursor_skill_mode
            ? { cursor_skill_mode: projectConfig.cursor_skill_mode }
            : {}),
        };
      }
    }
  }

  const registered = uniqueHarnessTargets(global?.registered_harnesses ?? []);
  if (registered.length === 0) {
    throw new HarnessUnionSyncError(
      "no_registered_harnesses",
      "No harnesses configured. Run ht harness set --harnesses <slugs>.",
    );
  }

  return { registered_harnesses: registered };
}

function resourceMtimeMs(rootPath: string, source: string): number | undefined {
  if (!source) return undefined;
  const full = isAbsolute(source) ? source : join(rootPath, source);
  try {
    if (!existsSync(full)) return undefined;
    return statSync(full).mtimeMs;
  } catch {
    return undefined;
  }
}

async function scanConfiguredSlices(
  platformIds: readonly string[],
  target: SerializerTarget,
  rootPath: string,
): Promise<Array<{
  platformId: string;
  resources: ResourceCreateInput[];
  mtimesMs: Map<string, number>;
}>> {
  const slices = [];
  for (const platformId of platformIds) {
    let resources: ResourceCreateInput[];
    if (target === "global") {
      const serializer = getPlatformSerializer(platformId);
      const scanned = serializer.scanGlobal
        ? await serializer.scanGlobal(rootPath)
        : await serializer.scan(rootPath);
      resources = dropPluginTranslatedResources(rootPath, scanned);
    } else {
      const scan = await scanPlatform(platformId, rootPath);
      resources = scan.resources;
    }
    const mtimesMs = new Map<string, number>();
    for (const resource of resources) {
      const mtime = resourceMtimeMs(rootPath, resource.source);
      if (mtime !== undefined) {
        mtimesMs.set(resourceIdentity(resource), mtime);
      }
    }
    slices.push({ platformId, resources, mtimesMs });
  }
  return slices;
}

/**
 * Union resources from the registered harness set, resolve same-identity
 * conflicts with last-write, then materialize through existing serializers.
 */
export async function syncConfiguredHarnesses(
  options: SyncConfiguredHarnessesOptions = {},
): Promise<SyncConfiguredHarnessesResult> {
  const scope = options.scope ?? "global";
  const target: SerializerTarget = scope === "global" ? "global" : "project";
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : undefined;
  const rootPath =
    target === "global"
      ? (options.homeRoot ?? resolveHomeRoot())
      : (projectRoot ?? resolve("."));

  const selection = resolveConfiguredSelection(
    target === "project" ? rootPath : undefined,
  );
  const platforms = uniqueHarnessTargets(selection.registered_harnesses);
  if (platforms.length < 2) {
    throw new HarnessUnionSyncError(
      "need_two_harnesses",
      "Add another harness to sync.",
    );
  }

  const slices = await scanConfiguredSlices(platforms, target, rootPath);
  const unioned = unionHarnessResources(slices, "last-write");
  const emitResources = toPortableEmitResources(unioned.resources);
  const serializeOptions = selection.cursor_skill_mode
    ? { target, skillCursorMode: selection.cursor_skill_mode }
    : { target };
  const pluginResourceMode = resolvePluginResourceMode(options.pluginResourceMode);
  const portablePlatforms = portableHarnessesForPluginFanout(platforms);
  const homeRoot = options.homeRoot ?? resolveHomeRoot();

  const previousSkillPlacements = collectManagedSkillPlacements(rootPath);
  const skipSkillNames = new Set(previousSkillPlacements.keys());
  const pinFromPrevious = previousSkillPlacements.size > 0
    ? { previousManagedPlacements: previousSkillPlacements }
    : undefined;
  const generated = await generateFiles(
    emitResources,
    platforms,
    rootPath,
    pinFromPrevious
      ? { ...serializeOptions, ...pinFromPrevious }
      : serializeOptions,
  );
  const preferred = pinSkillEmitsToExistingLivePaths(
    rootPath,
    preferSharedSkillEmits(generated, platforms, target, { skipSkillNames }),
    platforms,
    target,
    pinFromPrevious,
  );

  const extraResults: ApplyResult[] = [];
  let skillHubPlans: ReturnType<typeof planPluginSkillHub> = [];
  let extracted: ExtractHostPluginMaterialResult = {
    skills: [],
    resources: [],
    resourcePlugins: new Map(),
  };
  if (target === "global" && portablePlatforms.length > 0) {
    const occupied = new Set(unioned.resources.map(resourceIdentity));
    extracted = await extractHostPluginMaterial(
      unioned.resources,
      homeRoot,
      occupied,
    );
    if (extracted.resources.length > 0) {
      const extraGenerated = await generateFiles(
        toPortableEmitResources(extracted.resources),
        portablePlatforms,
        rootPath,
        pinFromPrevious
          ? { ...serializeOptions, ...pinFromPrevious }
          : serializeOptions,
      );
      extraResults.push(
        ...pinSkillEmitsToExistingLivePaths(
          rootPath,
          preferSharedSkillEmits(extraGenerated, portablePlatforms, target, {
            skipSkillNames,
          }),
          portablePlatforms,
          target,
          pinFromPrevious,
        ),
      );
    }
    skillHubPlans = planPluginSkillHub(
      extracted.skills,
      portablePlatforms,
      target,
    );
  }

  const paired = pairInstructionFiles(
    flattenUniqueFiles([...preferred, ...extraResults]),
    pluginResourceMode,
  );
  const files = paired.files;
  const filePaths = [
    ...files.map((file) => file.path.replace(/\\/g, "/")),
    ...paired.links.map((link) => link.path),
    ...skillHubPlans.map((plan) => plan.skillMdPath),
  ].filter((path, index, all) => all.indexOf(path) === index);
  const harness_changes = countHarnessSyncChanges({
    platforms,
    slices,
    unionResources: unioned.resources,
    extracted,
  });

  const payload = {
    registered_harnesses: platforms,
    conflict_policy: "last-write" as const,
    platforms_synced: platforms,
    files_written: filePaths.length,
    harness_changes,
    conflicts: unioned.conflicts,
    files: filePaths,
    plugin_resource_mode: pluginResourceMode,
    surface_warnings: [...preferred, ...extraResults].flatMap(
      (result) => result.surface_warnings ?? [],
    ),
  };

  if (options.dryRun) {
    return payload;
  }

  if (target === "project") {
    const gitOrigin = getGitOrigin(rootPath);
    if (gitOrigin) {
      const project = upsertProject({
        git_origin: normalizeGitUrl(gitOrigin),
        name: projectNameFromUrl(gitOrigin),
        local_path: rootPath,
      });
      createSnapshot({
        project_id: project.id,
        label: `Before harness sync (${platforms.join(", ")})`,
        state: captureManagedSnapshotState({
          rootPath,
          resources: emitResources,
          generated: preferred,
        }),
      });
    }
    writeFiles(files, rootPath);
  } else {
    await materializeFiles(files, rootPath, { conflictPolicy: "replace" });
  }
  applyInstructionLinks(rootPath, paired.links, pluginResourceMode);
  materializeSkillHubPlan(rootPath, skillHubPlans, pluginResourceMode);
  await writeHarnessSyncPluginTranslationMarkers({
    rootPath,
    scope: target === "global" ? "global" : "project",
    extracted,
    skillHubPlans,
    extraResults,
    portablePlatforms,
    target,
    serializeOptions,
  });

  persistWrittenMaterializations({
    scope: target === "global" ? "global" : "project",
    project_id: null,
    root_path: rootPath,
    platformResults: preferred.map((result: ApplyResult) => ({
      platformId: result.platformId,
      files: result.files,
      writtenPaths: result.files
        .map((file) => file.path.replace(/\\/g, "/"))
        .filter((path) => filePaths.includes(path)),
    })),
  });

  const afterSlices = await scanConfiguredSlices(platforms, target, rootPath);
  persistScanResults(afterSlices, {
    conflictPolicy: "overwrite",
    originRef: rootPath,
  });

  return payload;
}
