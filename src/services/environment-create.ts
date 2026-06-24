import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
} from "../models/environment.js";
import { setLayerDefaultEnvironment } from "../models/layer-model.js";
import { resolveLayerSelector } from "../models/layer-model.js";
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
import { collectLayerRequirements } from "./environment-requirements.js";

export type EnvironmentCreateMode = "blank" | "from-project" | "from-layer";

export interface EnvironmentCreateFromLayerPreview {
  mode: "from-layer";
  environment_name: string;
  configured_layer_ids: string[];
  values: Record<string, string>;
  secret_refs: Record<string, { provider: "env"; ref: string }>;
  model_configs: Array<{ name: string; model: string }>;
  missing_keys: MissingEnvironmentKey[];
  strict_failed: boolean;
  bound_layer_ids: string[];
}

export type EnvironmentCreateResult =
  | { mode: "blank"; payload: EnvironmentShowPayload }
  | {
      mode: "from-project";
      result: EnvironmentCapturePreview & { persisted: boolean; environment_id?: string };
    }
  | {
      mode: "from-layer";
      payload: EnvironmentShowPayload;
      preview: EnvironmentCreateFromLayerPreview;
      persisted: boolean;
    };

function normalizeLayerSelectors(selectors: string | string[]): string[] {
  const raw = Array.isArray(selectors) ? selectors : [selectors];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveCreateMode(input: {
  blank?: boolean;
  fromProject?: string;
  fromLayer?: string | string[];
}): EnvironmentCreateMode {
  const modes: EnvironmentCreateMode[] = [];
  if (input.blank) modes.push("blank");
  if (input.fromProject) modes.push("from-project");
  if (input.fromLayer !== undefined) modes.push("from-layer");

  if (modes.length > 1) {
    throw new Error(
      "Specify exactly one of --blank, --from-project, or --from-layer.",
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

export interface EnvironmentFromLayerResolved {
  values: Record<string, string>;
  secret_refs: Record<string, { provider: "env"; ref: string }>;
}

function resolveFromLayerKeyMaterial(input: {
  requirements: ReturnType<typeof collectLayerRequirements>;
  strict?: boolean;
  resolved?: EnvironmentFromLayerResolved;
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

async function runFromLayerCreate(input: {
  name: string;
  fromLayer: string | string[];
  bind?: boolean;
  strict?: boolean;
  dryRun?: boolean;
  description?: string;
  resolved?: EnvironmentFromLayerResolved;
}): Promise<EnvironmentCreateResult> {
  const layerSelectors = normalizeLayerSelectors(input.fromLayer);
  if (layerSelectors.length === 0) {
    throw new Error("--from-layer requires at least one configured layer selector.");
  }

  const requirements = collectLayerRequirements(layerSelectors);
  const { values, secretRefs, missingKeys } = resolveFromLayerKeyMaterial({
    requirements,
    strict: input.strict,
    resolved: input.resolved,
  });

  const modelConfigs = collectModelConfigsFromRequirements(requirements);
  const strictFailed = Boolean(input.strict && missingKeys.length > 0);
  const preview: EnvironmentCreateFromLayerPreview = {
    mode: "from-layer",
    environment_name: input.name,
    configured_layer_ids: requirements.configured_layer_ids,
    values,
    secret_refs: secretRefs,
    model_configs: modelConfigs,
    missing_keys: missingKeys,
    strict_failed: strictFailed,
    bound_layer_ids: [],
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
          references: { layers: [] },
        };
    return {
      mode: "from-layer",
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
    for (const layerSelector of layerSelectors) {
      const configuredLayer = resolveLayerSelector(layerSelector);
      if (!configuredLayer) {
        throw new Error(`Configured layer not found: ${layerSelector}`);
      }
      setLayerDefaultEnvironment(configuredLayer.id, environment.id);
      preview.bound_layer_ids.push(configuredLayer.id);
    }
  }

  return {
    mode: "from-layer",
    payload: showEnvironmentCommand(environment.id),
    preview,
    persisted: true,
  };
}

export async function runEnvironmentCreate(input: {
  name: string;
  fromProject?: string;
  fromLayer?: string | string[];
  blank?: boolean;
  refresh?: boolean;
  bind?: boolean;
  layers?: string[];
  strict?: boolean;
  dryRun?: boolean;
  includePermissions?: boolean;
  description?: string;
  fromLayerResolved?: EnvironmentFromLayerResolved;
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
      layerSelectors: input.layers,
      includePermissions: input.includePermissions,
      dryRun: input.dryRun,
      strict: input.strict,
    });
    return {
      mode: "from-project",
      result,
    };
  }

  const fromLayer = input.fromLayer;
  if (fromLayer === undefined) {
    throw new Error("Missing --from-layer selector.");
  }
  return runFromLayerCreate({
    name: input.name,
    fromLayer,
    bind: input.bind,
    strict: input.strict,
    dryRun: input.dryRun,
    description: input.description,
    resolved: input.fromLayerResolved,
  });
}
