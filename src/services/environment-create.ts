import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
} from "../models/environment.js";
import { setPluginDefaultEnvironment } from "../models/plugin-model.js";
import { resolvePluginSelector } from "../models/plugin-model.js";
import {
  createEnvironmentCommand,
  showEnvironmentCommand,
  type EnvironmentShowPayload,
} from "./environment-commands.js";
import {
  captureOrRefreshEnvironment,
  collectModelConfigsFromRequirements,
  isSecretKey,
  type EnvironmentCapturePreview,
  type MissingEnvironmentKey,
} from "./environment-capture.js";
import { collectPluginRequirements } from "./environment-requirements.js";

export type EnvironmentCreateMode = "blank" | "from-project" | "from-plugin";

export interface EnvironmentCreateFromPluginPreview {
  mode: "from-plugin";
  environment_name: string;
  configured_plugin_ids: string[];
  values: Record<string, string>;
  secret_refs: Record<string, { provider: "env"; ref: string }>;
  model_configs: Array<{ name: string; model: string }>;
  missing_keys: MissingEnvironmentKey[];
  strict_failed: boolean;
  bound_plugin_ids: string[];
}

export type EnvironmentCreateResult =
  | { mode: "blank"; payload: EnvironmentShowPayload }
  | {
      mode: "from-project";
      result: EnvironmentCapturePreview & { persisted: boolean; environment_id?: string };
    }
  | {
      mode: "from-plugin";
      payload: EnvironmentShowPayload;
      preview: EnvironmentCreateFromPluginPreview;
      persisted: boolean;
    };

function normalizePluginSelectors(selectors: string | string[]): string[] {
  const raw = Array.isArray(selectors) ? selectors : [selectors];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveCreateMode(input: {
  blank?: boolean;
  fromProject?: string;
  fromPlugin?: string | string[];
}): EnvironmentCreateMode {
  const modes: EnvironmentCreateMode[] = [];
  if (input.blank) modes.push("blank");
  if (input.fromProject) modes.push("from-project");
  if (input.fromPlugin !== undefined) modes.push("from-plugin");

  if (modes.length > 1) {
    throw new Error(
      "Specify exactly one of --blank, --from-project, or --from-plugin.",
    );
  }
  if (modes.length === 0) {
    return "blank";
  }
  const [mode] = modes;
  if (!mode) {
    return "blank";
  }
  return mode;
}

export interface EnvironmentFromPluginResolved {
  values: Record<string, string>;
  secret_refs: Record<string, { provider: "env"; ref: string }>;
}

function resolveFromPluginKeyMaterial(input: {
  requirements: ReturnType<typeof collectPluginRequirements>;
  strict?: boolean;
  resolved?: EnvironmentFromPluginResolved;
}): {
  values: Record<string, string>;
  secretRefs: Record<string, { provider: "env"; ref: string }>;
  missingKeys: MissingEnvironmentKey[];
} {
  const values: Record<string, string> = { ...(input.resolved?.values ?? {}) };
  const secretRefs: Record<string, { provider: "env"; ref: string }> = {
    ...(input.resolved?.secret_refs ?? {}),
  };
  const missingKeys: MissingEnvironmentKey[] = [];
  const resolvedKeys = new Set([
    ...Object.keys(values),
    ...Object.keys(secretRefs),
  ]);

  for (const key of input.requirements.required_keys) {
    if (resolvedKeys.has(key)) {
      continue;
    }

    const fromProcess = process.env[key];
    if (fromProcess !== undefined) {
      const keySources = input.requirements.key_sources[key] ?? [];
      const requireSecretRef =
        isSecretKey(key) || keySources.includes("plugin_needs");
      if (requireSecretRef) {
        secretRefs[key] = { provider: "env", ref: key };
      } else {
        values[key] = fromProcess;
      }
      continue;
    }

    missingKeys.push({
      key,
      sources: input.requirements.key_sources[key] ?? [],
      mode: input.strict ? "strict" : "warn",
    });
  }

  return { values, secretRefs, missingKeys };
}

async function runFromPluginCreate(input: {
  name: string;
  fromPlugin: string | string[];
  bind?: boolean;
  strict?: boolean;
  dryRun?: boolean;
  description?: string;
  resolved?: EnvironmentFromPluginResolved;
}): Promise<EnvironmentCreateResult> {
  const pluginSelectors = normalizePluginSelectors(input.fromPlugin);
  if (pluginSelectors.length === 0) {
    throw new Error("--from-plugin requires at least one configured plugin selector.");
  }

  const requirements = collectPluginRequirements(pluginSelectors);
  const { values, secretRefs, missingKeys } = resolveFromPluginKeyMaterial({
    requirements,
    strict: input.strict,
    resolved: input.resolved,
  });

  const modelConfigs = collectModelConfigsFromRequirements(requirements);
  const strictFailed = Boolean(input.strict && missingKeys.length > 0);
  const preview: EnvironmentCreateFromPluginPreview = {
    mode: "from-plugin",
    environment_name: input.name,
    configured_plugin_ids: requirements.configured_plugin_ids,
    values,
    secret_refs: secretRefs,
    model_configs: modelConfigs,
    missing_keys: missingKeys,
    strict_failed: strictFailed,
    bound_plugin_ids: [],
  };

  if (strictFailed || input.dryRun) {
    const existing = getEnvironmentByName(input.name);
    const payload = existing
      ? showEnvironmentCommand(existing.id)
      : {
          environment: {
            id: "",
            name: input.name,
            description: input.description ?? "",
            created_at: "",
            updated_at: "",
          },
          values: { env_vars: {}, model_configs: [], permissions: [] },
          secret_refs: {},
          references: { plugins: [] },
        };
    return {
      mode: "from-plugin",
      payload,
      preview,
      persisted: false,
    };
  }

  let environment = getEnvironmentByName(input.name);
  if (!environment) {
    environment = input.description
      ? createEnvironment({ name: input.name, description: input.description })
      : createEnvironmentCommand({ name: input.name });
  }

  for (const [key, value] of Object.entries(values)) {
    upsertEnvironmentEnvVar(environment.id, key, value);
  }
  for (const [key, secretRef] of Object.entries(secretRefs)) {
    addSecretRefToEnvironment(
      environment.id,
      key,
      secretRef.provider,
      secretRef.ref,
    );
  }
  for (const modelConfig of modelConfigs) {
    upsertEnvironmentModelConfig(environment.id, {
      name: modelConfig.name,
      model: modelConfig.model,
    });
  }

  if (input.bind) {
    for (const pluginSelector of pluginSelectors) {
      const configuredPlugin = resolvePluginSelector(pluginSelector);
      if (!configuredPlugin) {
        throw new Error(`Configured plugin not found: ${pluginSelector}`);
      }
      setPluginDefaultEnvironment(configuredPlugin.id, environment.id);
      preview.bound_plugin_ids.push(configuredPlugin.id);
    }
  }

  return {
    mode: "from-plugin",
    payload: showEnvironmentCommand(environment.id),
    preview,
    persisted: true,
  };
}

export async function runEnvironmentCreate(input: {
  name: string;
  fromProject?: string;
  fromPlugin?: string | string[];
  blank?: boolean;
  refresh?: boolean;
  bind?: boolean;
  plugins?: string[];
  strict?: boolean;
  dryRun?: boolean;
  includePermissions?: boolean;
  description?: string;
  fromPluginResolved?: EnvironmentFromPluginResolved;
}): Promise<EnvironmentCreateResult> {
  const mode = resolveCreateMode(input);

  if (mode === "blank") {
    const created = input.description
      ? createEnvironmentCommand({ name: input.name, description: input.description })
      : createEnvironmentCommand({ name: input.name });
    return {
      mode: "blank",
      payload: showEnvironmentCommand(created.id),
    };
  }

  if (mode === "from-project") {
    const projectRoot = input.fromProject;
    if (!projectRoot) {
      throw new Error("Missing --from-project path.");
    }
    const captureMode = input.refresh ? "refresh" : "capture";
    const result = await captureOrRefreshEnvironment({
      mode: captureMode,
      environmentName: input.name,
      projectRoot,
      pluginSelectors: input.plugins,
      includePermissions: input.includePermissions,
      dryRun: input.dryRun,
      strict: input.strict,
    });
    return {
      mode: "from-project",
      result,
    };
  }

  const fromPlugin = input.fromPlugin;
  if (fromPlugin === undefined) {
    throw new Error("Missing --from-plugin selector.");
  }
  return runFromPluginCreate({
    name: input.name,
    fromPlugin,
    bind: input.bind,
    strict: input.strict,
    dryRun: input.dryRun,
    description: input.description,
    resolved: input.fromPluginResolved,
  });
}
