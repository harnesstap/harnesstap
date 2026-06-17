import {
  addSecretRefToEnvironment,
  createEnvironment,
  deleteEnvironment,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
  hasEnvironmentReferences,
  listEnvironmentReferences,
  listEnvironments,
  removeEnvironmentEnvVar,
  removeEnvironmentModelConfig,
  removeEnvironmentPermission,
  removeSecretRefFromEnvironment,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
  upsertEnvironmentPermission,
} from "../models/environment.js";
import {
  setLayerDefaultEnvironment,
} from "../models/layer-model.js";
import { setDeckActiveEnvironment } from "../models/deck.js";
import { DECK_JSON_VERSION, DECK_SCHEMA } from "../types.js";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readDeckToml, writeDeckToml } from "./deck-export-import.js";
import { loadDeckActiveEnvironmentFragment, loadHomeEnvironmentFragment, resolveEnvironmentCascade, loadLayerDefaultFragments } from "./environment-cascade.js";
import { resolveConfiguredLayerOrThrow, resolveDeckByProjectRoot, resolveEnvironmentOrThrow } from "./environment-selectors.js";
import type {
  DeckJson,
  EnvVarMetadata,
  Environment,
  EnvironmentSecretProvider,
  ModelConfigMetadata,
  PermissionMetadata,
} from "../types.js";

export interface EnvironmentValuesPayload {
  env_vars: Record<string, string>;
  model_configs: Array<{ name: string; model: string; provider?: string }>;
  permissions: Array<{ name: string; action: string; pattern: string }>;
}

export interface EnvironmentShowPayload {
  environment: Environment;
  values: EnvironmentValuesPayload;
  secret_refs: Record<string, { provider: string; ref: string }>;
  references: ReturnType<typeof listEnvironmentReferences>;
}

function environmentValuesPayload(environmentId: string): EnvironmentValuesPayload {
  const envVars: Record<string, string> = {};
  const modelConfigs: Array<{ name: string; model: string; provider?: string }> = [];
  const permissions: Array<{ name: string; action: string; pattern: string }> = [];

  for (const resource of getEnvironmentResources(environmentId)) {
    if (resource.type === "env_var") {
      const metadata = resource.metadata as EnvVarMetadata;
      envVars[metadata.key] = metadata.value;
    } else if (resource.type === "model_config") {
      const metadata = resource.metadata as ModelConfigMetadata;
      modelConfigs.push({
        name: resource.name,
        model: metadata.model,
        ...(metadata.provider ? { provider: metadata.provider } : {}),
      });
    } else if (resource.type === "permission") {
      const metadata = resource.metadata as PermissionMetadata;
      permissions.push({
        name: resource.name,
        action: metadata.action,
        pattern: metadata.pattern,
      });
    }
  }

  return {
    env_vars: envVars,
    model_configs: modelConfigs.sort((a, b) => a.name.localeCompare(b.name)),
    permissions: permissions.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function environmentSecretRefsPayload(
  environmentId: string,
): Record<string, { provider: string; ref: string }> {
  return Object.fromEntries(
    getEnvironmentSecretRefs(environmentId).map((ref) => [
      ref.key,
      { provider: ref.provider, ref: ref.ref },
    ]),
  );
}

export function createEnvironmentCommand(input: {
  name: string;
  description?: string;
}): Environment {
  return createEnvironment(input);
}

export function listEnvironmentsCommand(): Array<{
  environment: Environment;
  value_count: number;
  secret_ref_count: number;
  reference_count: number;
}> {
  return listEnvironments().map((environment) => {
    const refs = listEnvironmentReferences(environment.id);
    return {
      environment,
      value_count: getEnvironmentResources(environment.id).length,
      secret_ref_count: getEnvironmentSecretRefs(environment.id).length,
      reference_count: refs.configured_layers.length + refs.decks.length,
    };
  });
}

export function showEnvironmentCommand(selector: string): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  return {
    environment,
    values: environmentValuesPayload(environment.id),
    secret_refs: environmentSecretRefsPayload(environment.id),
    references: listEnvironmentReferences(environment.id),
  };
}

export function deleteEnvironmentCommand(
  selector: string,
  options?: { force?: boolean },
): { deleted: boolean; references: ReturnType<typeof listEnvironmentReferences> } {
  const environment = resolveEnvironmentOrThrow(selector);
  const references = listEnvironmentReferences(environment.id);
  if (!options?.force && hasEnvironmentReferences(environment.id)) {
    throw new Error(
      `Environment "${environment.name}" is still referenced by configured layers or decks`,
    );
  }
  return {
    deleted: deleteEnvironment(environment.id),
    references,
  };
}

export function setEnvironmentVarCommand(
  selector: string,
  key: string,
  value: string,
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  upsertEnvironmentEnvVar(environment.id, key, value);
  return showEnvironmentCommand(environment.id);
}

export function unsetEnvironmentVarCommand(
  selector: string,
  key: string,
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  removeEnvironmentEnvVar(environment.id, key);
  return showEnvironmentCommand(environment.id);
}

export function setEnvironmentModelConfigCommand(
  selector: string,
  modelConfig: { model: string; provider?: string; name?: string },
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  upsertEnvironmentModelConfig(environment.id, modelConfig);
  return showEnvironmentCommand(environment.id);
}

export function unsetEnvironmentModelConfigCommand(
  selector: string,
  name = "default",
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  removeEnvironmentModelConfig(environment.id, name);
  return showEnvironmentCommand(environment.id);
}

export function setEnvironmentPermissionCommand(
  selector: string,
  permission: { action: PermissionMetadata["action"]; pattern: string; name?: string },
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  upsertEnvironmentPermission(environment.id, permission);
  return showEnvironmentCommand(environment.id);
}

export function unsetEnvironmentPermissionCommand(
  selector: string,
  permission: { action?: PermissionMetadata["action"]; pattern?: string; name?: string },
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  removeEnvironmentPermission(environment.id, permission);
  return showEnvironmentCommand(environment.id);
}

export function setEnvironmentSecretCommand(
  selector: string,
  input: {
    key: string;
    provider: EnvironmentSecretProvider;
    ref: string;
  },
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  addSecretRefToEnvironment(environment.id, input.key, input.provider, input.ref);
  return showEnvironmentCommand(environment.id);
}

export function unsetEnvironmentSecretCommand(
  selector: string,
  key: string,
): EnvironmentShowPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  removeSecretRefFromEnvironment(environment.id, key);
  return showEnvironmentCommand(environment.id);
}

export function setLayerEnvironmentCommand(
  layerSelector: string,
  environmentSelector: string,
): { configured_layer_id: string; environment_id: string } {
  const configuredLayer = resolveConfiguredLayerOrThrow(layerSelector);
  const environment = resolveEnvironmentOrThrow(environmentSelector);
  const updated = setLayerDefaultEnvironment(
    configuredLayer.id,
    environment.id,
  );
  if (!updated) {
    throw new Error(`Configured layer not found: ${configuredLayer.id}`);
  }
  return {
    configured_layer_id: configuredLayer.id,
    environment_id: environment.id,
  };
}

export function unsetLayerEnvironmentCommand(layerSelector: string): {
  configured_layer_id: string;
} {
  const configuredLayer = resolveConfiguredLayerOrThrow(layerSelector);
  const updated = setLayerDefaultEnvironment(configuredLayer.id, null);
  if (!updated) {
    throw new Error(`Configured layer not found: ${configuredLayer.id}`);
  }
  return { configured_layer_id: configuredLayer.id };
}

export function useEnvironmentPayload(selector: string): {
  environment_id: string;
  environment_name: string;
  active_environment: { name: string };
} {
  const environment = resolveEnvironmentOrThrow(selector);
  return {
    environment_id: environment.id,
    environment_name: environment.name,
    active_environment: { name: environment.name },
  };
}

export function useEnvironmentForProjectCommand(
  selector: string,
  projectRoot: string,
): {
  environment_id: string;
  environment_name: string;
  deck_id?: string;
  deck_file: string;
  deck_tracked: boolean;
  updated: boolean;
} {
  const environment = resolveEnvironmentOrThrow(selector);
  const deckDir = join(projectRoot, ".harnessdeck");
  mkdirSync(deckDir, { recursive: true });
  const deckFile = join(deckDir, "deck.toml");
  const parsedDeckJson = existsSync(deckFile)
    ? readDeckToml(deckFile)
    : undefined;
  const deckJson: DeckJson = {
    $schema: DECK_SCHEMA,
    version: DECK_JSON_VERSION,
    name: parsedDeckJson?.name && parsedDeckJson.name.length > 0
      ? parsedDeckJson.name
      : basename(projectRoot),
    layers: parsedDeckJson?.layers ?? [],
    environments: parsedDeckJson?.environments ?? [],
    active_environment: environment.name,
  };
  writeDeckToml(deckFile, deckJson);

  const deck = resolveDeckByProjectRoot(projectRoot);
  if (!deck) {
    return {
      environment_id: environment.id,
      environment_name: environment.name,
      deck_file: deckFile,
      deck_tracked: false,
      updated: true,
    };
  }
  setDeckActiveEnvironment(deck.id, environment.id);
  return {
    environment_id: environment.id,
    environment_name: environment.name,
    deck_id: deck.id,
    deck_file: deckFile,
    deck_tracked: true,
    updated: true,
  };
}

export function environmentActivePayload(input: {
  projectRoot?: string;
  configuredLayerIds?: string[];
}): {
  home?: ReturnType<typeof loadHomeEnvironmentFragment>;
  layer_defaults: ReturnType<typeof loadLayerDefaultFragments>;
  deck?: ReturnType<typeof loadDeckActiveEnvironmentFragment>;
  resolved: ReturnType<typeof resolveEnvironmentCascade>;
} {
  const home = loadHomeEnvironmentFragment();
  const layerDefaults = loadLayerDefaultFragments(input.configuredLayerIds ?? []);
  const deck = input.projectRoot
    ? loadDeckActiveEnvironmentFragment(input.projectRoot)
    : undefined;
  return {
    ...(home ? { home } : {}),
    layer_defaults: layerDefaults,
    ...(deck ? { deck } : {}),
    resolved: resolveEnvironmentCascade({
      ...(home ? { home } : {}),
      layerDefaults,
      ...(deck ? { deckActive: deck } : {}),
    }),
  };
}

export function environmentResolvePayload(input: {
  projectRoot: string;
  configuredLayerIds: string[];
}): {
  home?: ReturnType<typeof loadHomeEnvironmentFragment>;
  layer_defaults: ReturnType<typeof loadLayerDefaultFragments>;
  deck?: ReturnType<typeof loadDeckActiveEnvironmentFragment>;
  resolved: ReturnType<typeof resolveEnvironmentCascade>;
} {
  return environmentActivePayload({
    projectRoot: input.projectRoot,
    configuredLayerIds: input.configuredLayerIds,
  });
}
