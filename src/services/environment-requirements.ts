import { getLayerResources, getLayer, resolveLayerSelector } from "../models/layer-model.js";
import {
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import { resolveLayerGraph } from "./layer-resolver.js";
import { collectEnvironmentVarPlaceholders } from "./environment-var-substitution.js";
import type { AgentMetadata, EnvVarMetadata, McpServerMetadata } from "../types.js";

export type RequirementSource = "plugin_needs" | "mcp_env";

export interface EnvironmentRequirementCollection {
  configured_layer_ids: string[];
  plugin_ids: string[];
  required_keys: string[];
  required_models: Array<{ name: string; model: string }>;
  key_sources: Record<string, RequirementSource[]>;
}

const NOISE_ENV_KEY_PATTERNS: Array<string | RegExp> = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  /^npm_/i,
  /^NODE_/i,
];

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function isNoiseEnvKey(key: string): boolean {
  return NOISE_ENV_KEY_PATTERNS.some((pattern) =>
    typeof pattern === "string" ? key === pattern : pattern.test(key),
  );
}

function resolveScopedPluginIds(configuredLayerIds: string[]): string[] {
  const graph = resolveLayerGraph(configuredLayerIds);
  return unique(graph.resolved.map((layer) => layer.id));
}

export function collectRequirementsFromPlugins(
  pluginIds: string[],
): EnvironmentRequirementCollection {
  const requiredKeys = new Set<string>();
  const requiredModels = new Map<string, { name: string; model: string }>();
  const keySources = new Map<string, Set<RequirementSource>>();

  const rememberKey = (key: string, source: RequirementSource): void => {
    if (!key) return;
    requiredKeys.add(key);
    const current = keySources.get(key) ?? new Set<RequirementSource>();
    current.add(source);
    keySources.set(key, current);
  };

  for (const pluginId of pluginIds) {
    const plugin = getLayer(pluginId);
    if (!plugin) continue;

    for (const need of plugin.needs ?? []) {
      rememberKey(need, "plugin_needs");
    }

    for (const resource of getLayerResources(pluginId)) {
      if (resource.type === "mcp_server") {
        const metadata = resource.metadata as McpServerMetadata;
        for (const key of Object.keys(metadata.env ?? {})) {
          rememberKey(key, "mcp_env");
        }
        for (const value of Object.values(metadata.headers ?? {})) {
          for (const key of collectEnvironmentVarPlaceholders(value)) {
            rememberKey(key, "mcp_env");
          }
        }
      }
      if (resource.type === "agent") {
        const metadata = resource.metadata as AgentMetadata;
        if (metadata.model) {
          requiredModels.set(resource.name, {
            name: resource.name,
            model: metadata.model,
          });
        }
      }
    }
  }

  return {
    configured_layer_ids: [],
    plugin_ids: pluginIds,
    required_keys: [...requiredKeys].sort(),
    required_models: [...requiredModels.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    key_sources: Object.fromEntries(
      [...keySources.entries()].map(([key, sources]) => [key, [...sources].sort()]),
    ) as Record<string, RequirementSource[]>,
  };
}

export function collectLayerRequirements(
  layerSelectors: string[],
): EnvironmentRequirementCollection {
  const configuredLayerIds = layerSelectors.map((selector) => {
    const configuredLayer = resolveLayerSelector(selector);
    if (!configuredLayer) {
      throw new Error(`Configured layer not found: ${selector}`);
    }
    return configuredLayer.id;
  });
  const pluginIds = resolveScopedPluginIds(configuredLayerIds);
  const requirements = collectRequirementsFromPlugins(pluginIds);
  requirements.configured_layer_ids = configuredLayerIds;
  return requirements;
}

export function analyzeEnvironmentGaps(
  environmentId: string,
  layerSelector: string,
): { key: string; sources: string[]; status: "satisfied" | "missing" }[] {
  const requirements = collectLayerRequirements([layerSelector]);
  const envVarKeys = new Set(
    getEnvironmentResources(environmentId)
      .filter((resource) => resource.type === "env_var")
      .map((resource) => (resource.metadata as EnvVarMetadata).key),
  );
  const secretRefKeys = new Set(
    getEnvironmentSecretRefs(environmentId).map((ref) => ref.key),
  );

  return requirements.required_keys.map((key) => {
    const satisfied = envVarKeys.has(key) || secretRefKeys.has(key);
    return {
      key,
      sources: requirements.key_sources[key] ?? [],
      status: satisfied ? "satisfied" : "missing",
    };
  });
}

export function suggestProcessEnvKeys(
  requiredKeys: string[],
  options?: { processEnv?: NodeJS.ProcessEnv },
): { exact: string[]; fuzzy: string[]; noise: string[] } {
  const processEnv = options?.processEnv ?? process.env;
  const processKeys = Object.keys(processEnv);
  const requiredSet = new Set(requiredKeys);

  const exact = requiredKeys.filter((key) => processEnv[key] !== undefined).sort();
  const noise = processKeys.filter(isNoiseEnvKey).sort();

  const fuzzyMatches = new Set<string>();
  for (const requiredKey of requiredKeys) {
    if (requiredSet.has(requiredKey) && processEnv[requiredKey] !== undefined) {
      continue;
    }
    for (const processKey of processKeys) {
      if (processKey === requiredKey) continue;
      if (isNoiseEnvKey(processKey)) continue;
      if (
        processKey.includes(requiredKey) ||
        requiredKey.includes(processKey)
      ) {
        fuzzyMatches.add(processKey);
      }
    }
  }

  return {
    exact,
    fuzzy: [...fuzzyMatches].sort(),
    noise,
  };
}
