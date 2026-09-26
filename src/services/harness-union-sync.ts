import { resolve } from "node:path";
import { loadSettings } from "../config/settings.js";
import { getHarnesstapDir } from "../db/connection.js";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
} from "../models/harness.js";
import { upsertProject } from "../models/project.js";
import { createSnapshot } from "../models/snapshot.js";
import type {
  CursorSkillMode,
  ResourceCreateInput,
  SerializerTarget,
  SnapshotState,
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
import { uniqueHarnessTargets } from "./harness-targets.js";
import {
  extractHostPluginMaterial,
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
  persistScanResults,
  scanPlatform,
} from "./scanner.js";
import {
  flattenUniqueFiles,
  preferSharedSkillEmits,
} from "./shared-emit-paths.js";

export type HarnessUnionSyncCode =
  | "no_main_harness"
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
  main_harness: string;
  alias_harnesses: string[];
  platforms_synced: string[];
  files_written: number;
  conflicts: UnionConflict[];
  files: string[];
  plugin_resource_mode: PluginResourceMode;
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
  main_harness: string;
  alias_harnesses: string[];
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
      if (projectConfig?.main_harness) {
        return {
          main_harness: projectConfig.main_harness,
          alias_harnesses: projectConfig.alias_harnesses.filter(
            (alias) => alias !== projectConfig.main_harness,
          ),
          ...(projectConfig.cursor_skill_mode
            ? { cursor_skill_mode: projectConfig.cursor_skill_mode }
            : {}),
        };
      }
    }
  }

  if (!global?.main_harness) {
    throw new HarnessUnionSyncError(
      "no_main_harness",
      "No main harness configured. Run harnesstap harness set --main <slug>.",
    );
  }

  return {
    main_harness: global.main_harness,
    alias_harnesses: global.alias_harnesses.filter(
      (alias) => alias !== global.main_harness,
    ),
  };
}

async function scanConfiguredSlices(
  platformIds: readonly string[],
  target: SerializerTarget,
  rootPath: string,
): Promise<Array<{ platformId: string; resources: ResourceCreateInput[] }>> {
  const slices = [];
  for (const platformId of platformIds) {
    if (target === "global") {
      const serializer = getPlatformSerializer(platformId);
      const resources = serializer.scanGlobal
        ? await serializer.scanGlobal(rootPath)
        : await serializer.scan(rootPath);
      slices.push({ platformId, resources });
      continue;
    }
    const scan = await scanPlatform(platformId, rootPath);
    slices.push({ platformId, resources: scan.resources });
  }
  return slices;
}

/**
 * Union resources from the Settings active set (main + aliases), resolve
 * conflicts with main-wins, then materialize through existing serializers.
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
  const platforms = uniqueHarnessTargets([
    selection.main_harness,
    ...selection.alias_harnesses,
  ]);
  if (platforms.length < 2) {
    throw new HarnessUnionSyncError(
      "need_two_harnesses",
      "Add another harness to sync.",
    );
  }

  const slices = await scanConfiguredSlices(platforms, target, rootPath);
  const unioned = unionHarnessResources(slices, selection.main_harness);
  const emitResources = toPortableEmitResources(unioned.resources);
  const serializeOptions = selection.cursor_skill_mode
    ? { target, skillCursorMode: selection.cursor_skill_mode }
    : { target };
  const pluginResourceMode = resolvePluginResourceMode(options.pluginResourceMode);
  const portablePlatforms = portableHarnessesForPluginFanout(platforms);
  const homeRoot = options.homeRoot ?? resolveHomeRoot();

  const generated = await generateFiles(
    emitResources,
    platforms,
    rootPath,
    serializeOptions,
  );
  const preferred = preferSharedSkillEmits(generated, platforms, target);

  const extraResults: ApplyResult[] = [];
  let skillHubPlans: ReturnType<typeof planPluginSkillHub> = [];
  if (target === "global" && portablePlatforms.length > 0) {
    const occupied = new Set(unioned.resources.map(resourceIdentity));
    const extracted = await extractHostPluginMaterial(
      unioned.resources,
      homeRoot,
      occupied,
    );
    if (extracted.resources.length > 0) {
      const extraGenerated = await generateFiles(
        toPortableEmitResources(extracted.resources),
        portablePlatforms,
        rootPath,
        serializeOptions,
      );
      extraResults.push(
        ...preferSharedSkillEmits(extraGenerated, portablePlatforms, target),
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

  if (options.dryRun) {
    return {
      main_harness: selection.main_harness,
      alias_harnesses: selection.alias_harnesses,
      platforms_synced: platforms,
      files_written: filePaths.length,
      conflicts: unioned.conflicts,
      files: filePaths,
      plugin_resource_mode: pluginResourceMode,
    };
  }

  if (target === "project") {
    const gitOrigin = getGitOrigin(rootPath);
    if (gitOrigin) {
      const project = upsertProject({
        git_origin: normalizeGitUrl(gitOrigin),
        name: projectNameFromUrl(gitOrigin),
        local_path: rootPath,
      });
      const snapshotState: SnapshotState = {
        plugins: [],
        resources: emitResources,
        platform_files: Object.fromEntries(
          preferred.map((result) => [
            result.platformId,
            Object.fromEntries(result.files.map((file) => [file.path, file.content])),
          ]),
        ),
      };
      createSnapshot({
        project_id: project.id,
        label: `Before harness sync (${selection.main_harness})`,
        state: snapshotState,
      });
    }
    writeFiles(files, rootPath);
  } else {
    await materializeFiles(files, rootPath, { conflictPolicy: "replace" });
  }
  applyInstructionLinks(rootPath, paired.links, pluginResourceMode);
  materializeSkillHubPlan(rootPath, skillHubPlans, pluginResourceMode);

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

  return {
    main_harness: selection.main_harness,
    alias_harnesses: selection.alias_harnesses,
    platforms_synced: platforms,
    files_written: filePaths.length,
    conflicts: unioned.conflicts,
    files: filePaths,
    plugin_resource_mode: pluginResourceMode,
  };
}
