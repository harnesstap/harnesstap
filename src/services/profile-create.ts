import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  listPlugins,
} from "../models/plugin-model.js";
import { PROFILE_PLUGIN_TAG, isEmptyBuiltinProfile } from "../constants/profile.js";
import { listResources } from "../models/resource.js";
import type { Plugin } from "../types.js";
import { addPluginAttachment } from "./plugin-composition.js";
import { previewPluginFromProject } from "./plugin-from-project.js";
import {
  createProfileFromHome,
  previewProfileFromHome,
  ProfilePluginExistsError,
} from "./profile-from-home.js";
import { ProfileReservedNameError } from "./profile-commands.js";
import { persistMergedProjectScan } from "./scanner.js";

export { ProfilePluginExistsError };

export type ProfileCreateSource = "compose" | "home" | "project";
export type ProfileConflictPolicy = "skip" | "overwrite";

export interface ProfileCreateComposeInput {
  source: "compose";
  name: string;
  description?: string;
  pluginIds?: string[];
  resourceIds?: string[];
  use?: boolean;
}

export interface ProfileCreateHomeInput {
  source: "home";
  name: string;
  description?: string;
  conflictPolicy: ProfileConflictPolicy;
  platform?: string;
  use?: boolean;
}

export interface ProfileCreateProjectInput {
  source: "project";
  name: string;
  description?: string;
  projectPath: string;
  conflictPolicy: ProfileConflictPolicy;
  platform?: string;
  use?: boolean;
}

export type ProfileCreateInput =
  | ProfileCreateComposeInput
  | ProfileCreateHomeInput
  | ProfileCreateProjectInput;

export interface ProfileCreatePreview {
  source: ProfileCreateSource;
  name: string;
  totalImports: number;
  conflicts: unknown[];
  warnings: string[];
}

interface ComposeSelections {
  plugins: ReturnType<typeof listPlugins>;
  resourceIds: string[];
}

function assertProfileNameAvailable(name: string): void {
  if (isEmptyBuiltinProfile(name)) {
    throw new ProfileReservedNameError(name);
  }
  if (getPluginByName(name)) {
    throw new ProfilePluginExistsError(name);
  }
}

function createNewProfilePlugin(input: {
  name: string;
  description?: string;
}): Plugin {
  try {
    return createPlugin({
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      tags: [PROFILE_PLUGIN_TAG],
    });
  } catch (error) {
    if (getPluginByName(input.name)) {
      throw new ProfilePluginExistsError(input.name);
    }
    throw error;
  }
}

function resolveComposeSelections(
  input: ProfileCreateComposeInput,
): ComposeSelections {
  const pluginIds = [...new Set(input.pluginIds ?? [])];
  const resourceIds = [...new Set(input.resourceIds ?? [])];
  if (pluginIds.length + resourceIds.length === 0) {
    throw new Error("A composed profile requires at least one plugin or resource selection");
  }

  const pluginsById = new Map(listPlugins().map((plugin) => [plugin.id, plugin]));
  const resourcesById = new Map(
    listResources().map((resource) => [resource.id, resource]),
  );
  const plugins = pluginIds.map((id) => {
    const plugin = pluginsById.get(id);
    if (!plugin) {
      throw new Error(`Plugin not found: ${id}`);
    }
    return plugin;
  });
  for (const id of resourceIds) {
    if (!resourcesById.has(id)) {
      throw new Error(`Resource not found: ${id}`);
    }
  }
  return { plugins, resourceIds };
}

function assertProjectPath(projectPath: string): void {
  if (projectPath.trim().length === 0) {
    throw new Error("projectPath is required for project profile creation");
  }
}

function unreachableSource(source: never): never {
  throw new Error(`Unsupported profile create source: ${String(source)}`);
}

export async function previewProfileCreate(
  input: ProfileCreateInput,
): Promise<ProfileCreatePreview> {
  switch (input.source) {
    case "compose": {
      assertProfileNameAvailable(input.name);
      const selections = resolveComposeSelections(input);
      return {
        source: input.source,
        name: input.name,
        totalImports: selections.plugins.length + selections.resourceIds.length,
        conflicts: [],
        warnings: [],
      };
    }
    case "home": {
      const preview = await previewProfileFromHome({
        ...(input.platform ? { platform: input.platform } : {}),
      });
      return {
        source: input.source,
        name: input.name,
        totalImports: preview.totalImports,
        conflicts: preview.conflicts,
        warnings: preview.warning ? [preview.warning] : [],
      };
    }
    case "project": {
      assertProjectPath(input.projectPath);
      const preview = await previewPluginFromProject({
        name: input.name,
        projectRoot: input.projectPath,
        ...(input.platform ? { platform: input.platform } : {}),
      });
      return {
        source: input.source,
        name: input.name,
        totalImports: preview.totalImports,
        conflicts: preview.conflicts,
        warnings: [],
      };
    }
    default:
      return unreachableSource(input);
  }
}

export async function commitProfileCreate(input: ProfileCreateInput): Promise<{
  profile: { name: string; id: string; version: string };
  imported_count: number;
  used: boolean;
}> {
  switch (input.source) {
    case "compose": {
      assertProfileNameAvailable(input.name);
      const selections = resolveComposeSelections(input);
      const plugin = createNewProfilePlugin({
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      });
      for (const dependency of selections.plugins) {
        await addPluginAttachment({
          plugin,
          selector: dependency.name,
          type: "plugin",
        });
      }
      for (const resourceId of selections.resourceIds) {
        addResourceToPlugin(plugin.id, resourceId);
      }
      return {
        profile: {
          name: plugin.name,
          id: plugin.id,
          version: plugin.version,
        },
        imported_count: selections.plugins.length + selections.resourceIds.length,
        used: false,
      };
    }
    case "home": {
      assertProfileNameAvailable(input.name);
      const result = await createProfileFromHome({
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        conflictPolicy: input.conflictPolicy,
        ...(input.platform ? { platform: input.platform } : {}),
      });
      return {
        profile: {
          name: result.plugin.name,
          id: result.plugin.id,
          version: result.plugin.version,
        },
        imported_count: result.imported_count,
        used: false,
      };
    }
    case "project": {
      assertProjectPath(input.projectPath);
      assertProfileNameAvailable(input.name);
      const persisted = await persistMergedProjectScan(
        input.projectPath,
        input.platform,
        {
          conflictPolicy: input.conflictPolicy,
          originRef: input.projectPath,
          namespace: input.name,
        },
      );
      const plugin = createNewProfilePlugin({
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : { description: `Inferred from ${input.projectPath}` }),
      });
      for (const resource of persisted.resources) {
        addResourceToPlugin(plugin.id, resource.id);
      }
      return {
        profile: {
          name: plugin.name,
          id: plugin.id,
          version: plugin.version,
        },
        imported_count: persisted.resources.length,
        used: false,
      };
    }
    default:
      return unreachableSource(input);
  }
}
