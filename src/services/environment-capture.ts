import { resolvePluginSelector } from "../models/plugin-model.js";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
  upsertEnvironmentPermission,
} from "../models/environment.js";
import { getHarnessPreference, getProjectHarnessConfig } from "../models/harness.js";
import { getProjectByLocalPath, getProjectConfiguredPlugins } from "../models/project.js";
import { listResources } from "../models/resource.js";
import { detectPlatforms, scanPlatform } from "./scanner.js";
import { resolvePluginGraph } from "./plugin-resolver.js";
import {
  collectRequirementsFromPlugins,
  type EnvironmentRequirementCollection,
  type RequirementSource,
} from "./environment-requirements.js";
import type {
  EnvVarMetadata,
  Environment,
  PermissionMetadata,
  Resource,
} from "../types.js";

export type { EnvironmentRequirementCollection, RequirementSource };

const PROCESS_ENV_SECRET_PATTERNS = [
  /_TOKEN$/i,
  /_SECRET$/i,
  /_KEY$/i,
  /_PASSWORD$/i,
];

export interface MissingEnvironmentKey {
  key: string;
  sources: RequirementSource[];
  mode: "warn" | "strict";
}

export interface EnvironmentCapturePreview {
  mode: "capture" | "refresh";
  environment_name: string;
  configured_plugin_ids: string[];
  main_harness: string;
  requirements: EnvironmentRequirementCollection;
  values: Record<string, string>;
  secret_refs: Record<string, { provider: "env"; ref: string }>;
  model_configs: Array<{ name: string; model: string }>;
  permissions: Array<{ action: PermissionMetadata["action"]; pattern: string; name: string }>;
  missing_keys: MissingEnvironmentKey[];
  warnings: string[];
  strict_failed: boolean;
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function resolveMainHarness(projectRoot: string): string {
  const project = getProjectByLocalPath(projectRoot);
  if (project) {
    const projectHarness = getProjectHarnessConfig(project.id);
    if (projectHarness?.main_harness) {
      return projectHarness.main_harness;
    }
  }
  const globalHarness = getHarnessPreference();
  if (globalHarness?.main_harness) {
    return globalHarness.main_harness;
  }
  const detected = detectPlatforms(projectRoot);
  const [first] = detected;
  if (first) {
    return first;
  }
  throw new Error(`No harness detected for project: ${projectRoot}`);
}

function resolveScopedConfiguredPluginIds(
  projectRoot: string,
  pluginSelectors?: string[],
): string[] {
  if (pluginSelectors && pluginSelectors.length > 0) {
    return pluginSelectors.map((selector) => {
      const configuredPlugin = resolvePluginSelector(selector);
      if (!configuredPlugin) {
        throw new Error(`Configured plugin not found: ${selector}`);
      }
      return configuredPlugin.id;
    });
  }

  const project = getProjectByLocalPath(projectRoot);
  if (!project) {
    throw new Error(
      `No tracked project found at ${projectRoot}; pass --plugins explicitly`,
    );
  }

  const applied = getProjectConfiguredPlugins(project.id);
  const configuredPluginIds = unique(applied.map((row) => row.plugin_id));
  if (configuredPluginIds.length === 0) {
    throw new Error(
      `Project ${projectRoot} has no applied configured plugins; pass --plugins explicitly`,
    );
  }
  return configuredPluginIds;
}

function resolveScopedPluginIds(configuredPluginIds: string[]): string[] {
  const graph = resolvePluginGraph(configuredPluginIds);
  return unique(graph.resolved.map((plugin) => plugin.id));
}

function valueFromScannedResources(
  resources: Resource[],
  key: string,
): string | undefined {
  const match = resources.find((resource) => {
    if (resource.type !== "env_var") return false;
    const metadata = resource.metadata as EnvVarMetadata;
    return metadata.key === key;
  });
  if (!match) return undefined;
  const metadata = match.metadata as EnvVarMetadata;
  return metadata.value;
}

function valueFromLibraryResources(key: string): string | undefined {
  const match = listResources({ type: "env_var" }).find((resource) => {
    const metadata = resource.metadata as EnvVarMetadata;
    return metadata.key === key;
  });
  if (!match) return undefined;
  const metadata = match.metadata as EnvVarMetadata;
  return metadata.value;
}

export function isSecretKey(key: string): boolean {
  return PROCESS_ENV_SECRET_PATTERNS.some((pattern) => pattern.test(key));
}

function collectPermissionsFromScan(resources: Resource[]): Array<{
  action: PermissionMetadata["action"];
  pattern: string;
  name: string;
}> {
  return resources
    .filter((resource) => resource.type === "permission")
    .map((resource) => {
      const metadata = resource.metadata as PermissionMetadata;
      return {
        action: metadata.action,
        pattern: metadata.pattern,
        name: resource.name,
      };
    });
}

export function collectModelConfigsFromRequirements(
  requirements: EnvironmentRequirementCollection,
): Array<{ name: string; model: string }> {
  const libraryModels = listResources({ type: "model_config" });
  const byName = new Map<string, { name: string; model: string }>();

  for (const requirement of requirements.required_models) {
    const libraryMatch = libraryModels.find((resource) => resource.name === requirement.name);
    if (libraryMatch) {
      const metadata = libraryMatch.metadata as { model?: string };
      if (metadata.model) {
        byName.set(requirement.name, { name: requirement.name, model: metadata.model });
        continue;
      }
    }
    byName.set(requirement.name, requirement);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function previewEnvironmentCapture(input: {
  mode: "capture" | "refresh";
  environmentName: string;
  projectRoot: string;
  pluginSelectors?: string[];
  includePermissions?: boolean;
  strict?: boolean;
}): Promise<EnvironmentCapturePreview> {
  const configuredPluginIds = resolveScopedConfiguredPluginIds(
    input.projectRoot,
    input.pluginSelectors,
  );
  const pluginIds = resolveScopedPluginIds(configuredPluginIds);
  const requirements = collectRequirementsFromPlugins(pluginIds);
  requirements.configured_plugin_ids = configuredPluginIds;

  const mainHarness = resolveMainHarness(input.projectRoot);
  const scanResult = await scanPlatform(mainHarness, input.projectRoot);
  const scannedResources = scanResult.resources.map(
    (resource): Resource =>
      ({
        id: `scan:${resource.type}:${resource.name}`,
        type: resource.type,
        name: resource.name,
        description: resource.description,
        content: resource.content,
        metadata: resource.metadata,
        source: resource.source,
        namespace: "",
        origin_kind: "manual",
        origin_ref: "",
        content_hash: "",
        content_blob_ref: "",
        created_at: "",
        updated_at: "",
      }) satisfies Resource,
  );

  const values: Record<string, string> = {};
  const secretRefs: Record<string, { provider: "env"; ref: string }> = {};
  const missingKeys: MissingEnvironmentKey[] = [];
  const warnings: string[] = [];

  for (const key of requirements.required_keys) {
    const fromScan = valueFromScannedResources(scannedResources, key);
    if (fromScan !== undefined) {
      values[key] = fromScan;
      continue;
    }

    const fromLibrary = valueFromLibraryResources(key);
    if (fromLibrary !== undefined) {
      values[key] = fromLibrary;
      continue;
    }

    const fromProcess = process.env[key];
    if (fromProcess !== undefined) {
      const keySources = requirements.key_sources[key] ?? [];
      const requireSecretRef =
        isSecretKey(key) || keySources.includes("plugin_needs");
      if (requireSecretRef) {
        secretRefs[key] = { provider: "env", ref: key };
      } else {
        values[key] = fromProcess;
      }
      continue;
    }

    const missing: MissingEnvironmentKey = {
      key,
      sources: requirements.key_sources[key] ?? [],
      mode: input.strict ? "strict" : "warn",
    };
    missingKeys.push(missing);
    warnings.push(`Missing required key: ${key}`);
  }

  const permissions = input.includePermissions
    ? collectPermissionsFromScan(scannedResources)
    : [];
  const modelConfigs = collectModelConfigsFromRequirements(requirements);
  const strictFailed = Boolean(input.strict && missingKeys.length > 0);

  return {
    mode: input.mode,
    environment_name: input.environmentName,
    configured_plugin_ids: configuredPluginIds,
    main_harness: mainHarness,
    requirements,
    values,
    secret_refs: secretRefs,
    model_configs: modelConfigs,
    permissions,
    missing_keys: missingKeys,
    warnings,
    strict_failed: strictFailed,
  };
}

function ensureEnvironmentForCapture(
  environmentName: string,
  mode: "capture" | "refresh",
): Environment {
  const existing = getEnvironmentByName(environmentName);
  if (mode === "capture") {
    if (existing) return existing;
    return createEnvironment({
      name: environmentName,
      description: `captured environment ${environmentName}`,
    });
  }
  if (!existing) {
    throw new Error(`Environment not found for refresh: ${environmentName}`);
  }
  return existing;
}

export async function captureOrRefreshEnvironment(input: {
  mode: "capture" | "refresh";
  environmentName: string;
  projectRoot: string;
  pluginSelectors?: string[];
  includePermissions?: boolean;
  strict?: boolean;
  dryRun?: boolean;
}): Promise<EnvironmentCapturePreview & { persisted: boolean; environment_id?: string }> {
  const preview = await previewEnvironmentCapture(input);
  if (preview.strict_failed) {
    return {
      ...preview,
      persisted: false,
    };
  }
  if (input.dryRun) {
    return {
      ...preview,
      persisted: false,
    };
  }

  const environment = ensureEnvironmentForCapture(input.environmentName, input.mode);
  for (const [key, value] of Object.entries(preview.values)) {
    upsertEnvironmentEnvVar(environment.id, key, value);
  }
  for (const [key, secretRef] of Object.entries(preview.secret_refs)) {
    addSecretRefToEnvironment(
      environment.id,
      key,
      secretRef.provider,
      secretRef.ref,
    );
  }
  for (const modelConfig of preview.model_configs) {
    upsertEnvironmentModelConfig(environment.id, {
      name: modelConfig.name,
      model: modelConfig.model,
    });
  }
  for (const permission of preview.permissions) {
    upsertEnvironmentPermission(environment.id, permission);
  }

  return {
    ...preview,
    persisted: true,
    environment_id: environment.id,
  };
}
