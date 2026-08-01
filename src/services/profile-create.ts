import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
  listLayers,
} from "../models/layer-model.js";
import { PROFILE_LAYER_TAG, isEmptyBuiltinProfile } from "../constants/profile.js";
import { listResources } from "../models/resource.js";
import type { Layer } from "../types.js";
import { addLayerAttachment } from "./layer-composition.js";
import { previewLayerFromProject } from "./layer-from-project.js";
import {
  createProfileFromHome,
  previewProfileFromHome,
  ProfileLayerExistsError,
} from "./profile-from-home.js";
import { ProfileReservedNameError } from "./profile-commands.js";
import { persistMergedProjectScan } from "./scanner.js";

export { ProfileLayerExistsError };

export type ProfileCreateSource = "compose" | "home" | "project";
export type ProfileConflictPolicy = "skip" | "overwrite";

export interface ProfileCreateComposeInput {
  source: "compose";
  name: string;
  description?: string;
  layerIds?: string[];
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
  layers: ReturnType<typeof listLayers>;
  resourceIds: string[];
}

function assertProfileNameAvailable(name: string): void {
  if (isEmptyBuiltinProfile(name)) {
    throw new ProfileReservedNameError(name);
  }
  if (getLayerByName(name)) {
    throw new ProfileLayerExistsError(name);
  }
}

function createNewProfileLayer(input: {
  name: string;
  description?: string;
}): Layer {
  try {
    return createLayer({
      name: input.name,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      tags: [PROFILE_LAYER_TAG],
    });
  } catch (error) {
    if (getLayerByName(input.name)) {
      throw new ProfileLayerExistsError(input.name);
    }
    throw error;
  }
}

function resolveComposeSelections(
  input: ProfileCreateComposeInput,
): ComposeSelections {
  const layerIds = [...new Set(input.layerIds ?? [])];
  const resourceIds = [...new Set(input.resourceIds ?? [])];
  if (layerIds.length + resourceIds.length === 0) {
    throw new Error("A composed profile requires at least one layer or resource selection");
  }

  const layersById = new Map(listLayers().map((layer) => [layer.id, layer]));
  const resourcesById = new Map(
    listResources().map((resource) => [resource.id, resource]),
  );
  const layers = layerIds.map((id) => {
    const layer = layersById.get(id);
    if (!layer) {
      throw new Error(`Layer not found: ${id}`);
    }
    return layer;
  });
  for (const id of resourceIds) {
    if (!resourcesById.has(id)) {
      throw new Error(`Resource not found: ${id}`);
    }
  }
  return { layers, resourceIds };
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
        totalImports: selections.layers.length + selections.resourceIds.length,
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
      const preview = await previewLayerFromProject({
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
      const layer = createNewProfileLayer({
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
      });
      for (const dependency of selections.layers) {
        await addLayerAttachment({
          layer,
          selector: dependency.name,
          type: "layer",
        });
      }
      for (const resourceId of selections.resourceIds) {
        addResourceToLayer(layer.id, resourceId);
      }
      return {
        profile: {
          name: layer.name,
          id: layer.id,
          version: layer.version,
        },
        imported_count: selections.layers.length + selections.resourceIds.length,
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
          name: result.layer.name,
          id: result.layer.id,
          version: result.layer.version,
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
      const layer = createNewProfileLayer({
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : { description: `Inferred from ${input.projectPath}` }),
      });
      for (const resource of persisted.resources) {
        addResourceToLayer(layer.id, resource.id);
      }
      return {
        profile: {
          name: layer.name,
          id: layer.id,
          version: layer.version,
        },
        imported_count: persisted.resources.length,
        used: false,
      };
    }
    default:
      return unreachableSource(input);
  }
}
