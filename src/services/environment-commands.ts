import {
  loadHomeEnvironmentFragment,
  loadLayerDefaultFragments,
  resolveEnvironmentCascade,
} from "./environment-cascade.js";
import {
  getGlobalActiveEnvironmentName,
  setGlobalActiveEnvironment,
  setLocalActiveEnvironment,
} from "./environment-session.js";
import { resolveConfiguredLayerOrThrow, resolveEnvironmentOrThrow } from "./environment-selectors.js";
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
} from "../models/plugin-model.js";
import { markLayerDirty } from "./layer-versioning.js";
import type {
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
      reference_count: refs.layers.length,
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
      `Environment "${environment.name}" is still referenced by configured layers`,
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
  markLayerDirty(configuredLayer.id);
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
  markLayerDirty(configuredLayer.id);
  const updated = setLayerDefaultEnvironment(configuredLayer.id, null);
  if (!updated) {
    throw new Error(`Configured layer not found: ${configuredLayer.id}`);
  }
  return { configured_layer_id: configuredLayer.id };
}

export function useEnvironmentCommand(
  selector: string,
  options?: { local?: boolean },
): {
  environment_id: string;
  environment_name: string;
  scope: "global" | "local";
  active_environment_file: string;
} {
  const environment = resolveEnvironmentOrThrow(selector);
  const activeEnvironmentFile = options?.local
    ? setLocalActiveEnvironment(environment.name)
    : setGlobalActiveEnvironment(environment.name);
  return {
    environment_id: environment.id,
    environment_name: environment.name,
    scope: options?.local ? "local" : "global",
    active_environment_file: activeEnvironmentFile,
  };
}

/** @deprecated Use useEnvironmentCommand */
export function useEnvironmentPayload(selector: string): {
  environment_id: string;
  environment_name: string;
  active_environment: { name: string };
} {
  const result = useEnvironmentCommand(selector);
  return {
    environment_id: result.environment_id,
    environment_name: result.environment_name,
    active_environment: { name: result.environment_name },
  };
}

export function environmentCascadePayload(input: {
  configuredLayerIds?: string[];
}): {
  global_environment: string | null;
  home?: ReturnType<typeof loadHomeEnvironmentFragment>;
  layer_defaults: ReturnType<typeof loadLayerDefaultFragments>;
  resolved: ReturnType<typeof resolveEnvironmentCascade>;
} {
  const home = loadHomeEnvironmentFragment();
  const layerDefaults = loadLayerDefaultFragments(input.configuredLayerIds ?? []);
  return {
    global_environment: getGlobalActiveEnvironmentName() ?? null,
    ...(home ? { home } : {}),
    layer_defaults: layerDefaults,
    resolved: resolveEnvironmentCascade({
      ...(home ? { home } : {}),
      layerDefaults,
    }),
  };
}
