import { getEnvironment, getEnvironmentByName } from "../models/environment.js";
import { getPluginById } from "../models/plugin-model.js";
import {
  fragmentFromEnvironmentId,
  loadPluginDefaultFragments,
  resolveEnvironmentCascade,
  type EnvironmentFragment,
} from "./environment-cascade.js";
import {
  getEffectiveActiveEnvironmentName,
  getGlobalActiveEnvironmentName,
  getLocalActiveEnvironmentName,
} from "./environment-session.js";
import { resolveSecretRefsBestEffort, type SecretRefWarning } from "./secret-resolver.js";

export interface EnvironmentVarDrift {
  key: string;
  expected: string;
  actual: string | null;
  kind: "missing" | "mismatch";
}

export interface EnvironmentStatusPayload {
  global_environment: string | null;
  local_environment: string | null;
  effective_environment: string | null;
  plugin_defaults: Array<{ plugin_id: string; environment_name: string | null }>;
  resolved: EnvironmentFragment;
  secret_warnings: SecretRefWarning[];
  has_drift: boolean;
  drift: EnvironmentVarDrift[];
}

function activeEnvironmentFragment(name: string | undefined): EnvironmentFragment | undefined {
  if (!name) {
    return undefined;
  }
  const environment = getEnvironmentByName(name);
  if (!environment) {
    return undefined;
  }
  return fragmentFromEnvironmentId(environment.id);
}

function buildPluginDefaultSummary(
  configuredPluginIds: string[],
): EnvironmentStatusPayload["plugin_defaults"] {
  return configuredPluginIds.map((pluginId) => {
    const plugin = getPluginById(pluginId);
    const environmentId = plugin?.default_environment_id;
    const environment = environmentId ? getEnvironment(environmentId) : undefined;
    return {
      plugin_id: pluginId,
      environment_name: environment?.name ?? null,
    };
  });
}

function detectVarDrift(expectedVars: Record<string, string>): EnvironmentVarDrift[] {
  const drift: EnvironmentVarDrift[] = [];
  for (const [key, expected] of Object.entries(expectedVars).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const actual = process.env[key] ?? null;
    if (actual === null) {
      drift.push({ key, expected, actual, kind: "missing" });
      continue;
    }
    if (actual !== expected) {
      drift.push({ key, expected, actual, kind: "mismatch" });
    }
  }
  return drift;
}

export function detectEnvironmentStatus(input: {
  configuredPluginIds?: string[];
} = {}): EnvironmentStatusPayload {
  const globalEnvironment = getGlobalActiveEnvironmentName() ?? null;
  const localEnvironment = getLocalActiveEnvironmentName() ?? null;
  const effectiveEnvironment = getEffectiveActiveEnvironmentName() ?? null;
  const configuredPluginIds = input.configuredPluginIds ?? [];

  const resolved = resolveEnvironmentCascade({
    home: activeEnvironmentFragment(effectiveEnvironment ?? undefined),
    pluginDefaults: loadPluginDefaultFragments(configuredPluginIds),
  });
  const { resolved: resolvedSecrets, warnings: secretWarnings } = resolveSecretRefsBestEffort(
    resolved.secretRefs,
  );
  const expectedVars = { ...resolved.vars, ...resolvedSecrets };
  const drift = detectVarDrift(expectedVars);

  return {
    global_environment: globalEnvironment,
    local_environment: localEnvironment,
    effective_environment: effectiveEnvironment,
    plugin_defaults: buildPluginDefaultSummary(configuredPluginIds),
    resolved,
    secret_warnings: secretWarnings,
    has_drift: drift.length > 0,
    drift,
  };
}
