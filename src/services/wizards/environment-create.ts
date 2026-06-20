import { resolve } from "node:path";
import { listLayers } from "../../models/layer-model.js";
import { toLayerChoices } from "../completion/choices.js";
import {
  collectLayerRequirements,
  suggestProcessEnvKeys,
  type RequirementSource,
} from "../environment-requirements.js";
import {
  isSecretKey,
  previewEnvironmentCapture,
} from "../environment-capture.js";
import {
  runEnvironmentCreate,
  type EnvironmentCreateResult,
  type EnvironmentFromLayerResolved,
} from "../environment-create.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import {
  promptForChoice,
  promptForConfirmation,
  promptForSearchableChoice,
  promptForValue,
} from "./shared.js";

export type EnvironmentCreateSource = "from-project" | "from-layer" | "blank";

export type EnvironmentCreateWizardOutcome =
  | { status: "cancelled" }
  | { status: "confirmed"; result: EnvironmentCreateResult };

export type EnvSuggestionChoice = {
  name: string;
  value: string;
  description?: string;
  defaultSelected: boolean;
};

export function buildEnvSuggestionChoices(
  requiredKeys: string[],
  processEnv: NodeJS.ProcessEnv = process.env,
): EnvSuggestionChoice[] {
  const suggestions = suggestProcessEnvKeys(requiredKeys, { processEnv });
  const choices: EnvSuggestionChoice[] = [];

  for (const key of suggestions.exact) {
    choices.push({
      name: `${key} (exact match)`,
      value: key,
      description: `process.env.${key}`,
      defaultSelected: true,
    });
  }

  for (const key of suggestions.fuzzy) {
    choices.push({
      name: `${key} (fuzzy match)`,
      value: key,
      description: `process.env.${key}`,
      defaultSelected: false,
    });
  }

  return choices;
}

function resolveRequiredKeyForProcessKey(
  processKey: string,
  requiredKeys: string[],
): string | undefined {
  if (requiredKeys.includes(processKey)) {
    return processKey;
  }

  const matches = requiredKeys.filter(
    (requiredKey) =>
      processKey.includes(requiredKey) || requiredKey.includes(processKey),
  );
  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((left, right) => right.length - left.length)[0];
}

function requiresSecretRef(
  key: string,
  sources: RequirementSource[],
): boolean {
  return isSecretKey(key) || sources.includes("plugin_needs");
}

async function resolveSecretKeyPolicy(input: {
  key: string;
  value: string;
  sources: RequirementSource[];
  resolved: EnvironmentFromLayerResolved;
}): Promise<void> {
  if (!requiresSecretRef(input.key, input.sources)) {
    input.resolved.values[input.key] = input.value;
    return;
  }

  const useLiteral = await promptForConfirmation({
    message: `Store ${input.key} as a literal value? (default is secret reference)`,
    default: false,
  });
  if (useLiteral) {
    const confirmed = await promptForConfirmation({
      message:
        `Warning: storing ${input.key} as a literal secret in the environment record. Continue?`,
      default: false,
    });
    if (!confirmed) {
      input.resolved.secret_refs[input.key] = {
        provider: "env",
        ref: input.key,
      };
      return;
    }
    input.resolved.values[input.key] = input.value;
    return;
  }

  input.resolved.secret_refs[input.key] = {
    provider: "env",
    ref: input.key,
  };
}

async function collectFromLayerResolutions(input: {
  layerSelector: string;
  processEnv?: NodeJS.ProcessEnv;
}): Promise<EnvironmentFromLayerResolved> {
  const processEnv = input.processEnv ?? process.env;
  const requirements = collectLayerRequirements([input.layerSelector]);
  const resolved: EnvironmentFromLayerResolved = {
    values: {},
    secret_refs: {},
  };
  const coveredKeys = new Set<string>();

  const suggestionChoices = buildEnvSuggestionChoices(
    requirements.required_keys,
    processEnv,
  );
  if (suggestionChoices.length > 0) {
    const selectedProcessKeys = await promptForSearchableMultiSelect({
      message: "Import matching process environment variables?",
      choices: suggestionChoices.map((choice) => ({
        name: choice.name,
        value: choice.value,
        description: choice.description,
      })),
      default: suggestionChoices
        .filter((choice) => choice.defaultSelected)
        .map((choice) => choice.value),
    });

    for (const processKey of selectedProcessKeys) {
      const requiredKey = resolveRequiredKeyForProcessKey(
        processKey,
        requirements.required_keys,
      );
      if (!requiredKey || coveredKeys.has(requiredKey)) {
        continue;
      }

      const value = processEnv[processKey];
      if (value === undefined) {
        continue;
      }

      coveredKeys.add(requiredKey);
      const sources = requirements.key_sources[requiredKey] ?? [];
      if (requiresSecretRef(requiredKey, sources)) {
        resolved.secret_refs[requiredKey] = {
          provider: "env",
          ref: processKey,
        };
      } else {
        resolved.values[requiredKey] = value;
      }
    }
  }

  for (const key of requirements.required_keys) {
    if (coveredKeys.has(key)) {
      continue;
    }

    const sources = requirements.key_sources[key] ?? [];
    const fromProcess = processEnv[key];
    if (fromProcess !== undefined) {
      coveredKeys.add(key);
      await resolveSecretKeyPolicy({
        key,
        value: fromProcess,
        sources,
        resolved,
      });
      continue;
    }

    const manualValue = await promptForValue({
      message: `Value for ${key}`,
    });
    coveredKeys.add(key);
    await resolveSecretKeyPolicy({
      key,
      value: manualValue,
      sources,
      resolved,
    });
  }

  return resolved;
}

async function promptOptionalDescription(
  description?: string,
): Promise<string | undefined> {
  if (description) {
    return description;
  }

  const addDescription = await promptForConfirmation({
    message: "Add a description?",
    default: false,
  });
  if (!addDescription) {
    return undefined;
  }

  return promptForValue({ message: "Description" });
}

function printFromProjectPreviewSummary(
  preview: Awaited<ReturnType<typeof previewEnvironmentCapture>>,
): void {
  console.log("");
  console.log(`Environment: ${preview.environment_name}`);
  console.log(`Project harness: ${preview.main_harness}`);
  console.log(`Configured layers: ${preview.configured_layer_ids.length}`);
  console.log(`Captured values: ${Object.keys(preview.values).length}`);
  console.log(`Secret refs: ${Object.keys(preview.secret_refs).length}`);
  console.log(`Missing keys: ${preview.missing_keys.length}`);
  console.log("");
}

function printFromLayerPreviewSummary(input: {
  name: string;
  layerSelector: string;
  resolved: EnvironmentFromLayerResolved;
  bind: boolean;
}): void {
  console.log("");
  console.log(`Environment: ${input.name}`);
  console.log(`Layer: ${input.layerSelector}`);
  console.log(`Literal values: ${Object.keys(input.resolved.values).length}`);
  console.log(`Secret refs: ${Object.keys(input.resolved.secret_refs).length}`);
  console.log(`Bind as default: ${input.bind ? "yes" : "no"}`);
  console.log("");
}

export async function runEnvironmentCreateWizard(input: {
  name: string;
  description?: string;
}): Promise<EnvironmentCreateWizardOutcome> {
  const source = await promptForChoice<EnvironmentCreateSource>({
    message: "How should this environment be created?",
    choices: [
      { name: "Capture from project", value: "from-project" },
      { name: "Build from layer requirements", value: "from-layer" },
      { name: "Blank environment", value: "blank" },
    ],
    default: "from-project",
  });

  if (source === "blank") {
    const description = await promptOptionalDescription(input.description);
    const confirmed = await promptForConfirmation({
      message: `Create blank environment ${input.name}?`,
      default: true,
    });
    if (!confirmed) {
      return { status: "cancelled" };
    }

    const result = await runEnvironmentCreate({
      name: input.name,
      blank: true,
      description,
    });
    return { status: "confirmed", result };
  }

  if (source === "from-project") {
    const projectRoot = resolve(
      await promptForValue({
        message: "Project directory",
        default: ".",
      }),
    );

    let layerSelectors: string[] | undefined;
    const specifyLayers = await promptForConfirmation({
      message: "Specify configured layers explicitly?",
      default: false,
    });
    if (specifyLayers) {
      const layerChoices = toLayerChoices();
      if (layerChoices.length === 0) {
        throw new Error("No configured layers found.");
      }
      layerSelectors = await promptForSearchableMultiSelect({
        message: "Configured layers to scope import",
        choices: layerChoices.map((choice) => ({
          name: choice.name,
          value: choice.value,
        })),
      });
      if (layerSelectors.length === 0) {
        throw new Error("Select at least one configured layer.");
      }
    }

    const preview = await previewEnvironmentCapture({
      mode: "capture",
      environmentName: input.name,
      projectRoot,
      layerSelectors,
    });
    printFromProjectPreviewSummary(preview);

    const confirmed = await promptForConfirmation({
      message: "Create environment from this project preview?",
      default: true,
    });
    if (!confirmed) {
      return { status: "cancelled" };
    }

    const result = await runEnvironmentCreate({
      name: input.name,
      fromProject: projectRoot,
      layers: layerSelectors,
      description: input.description,
    });
    return { status: "confirmed", result };
  }

  const layers = listLayers();
  if (layers.length === 0) {
    throw new Error("No configured layers found.");
  }

  const layerSelector = await promptForSearchableChoice({
    message: "Configured layer",
    choices: toLayerChoices(),
  });
  const resolved = await collectFromLayerResolutions({ layerSelector });
  const bind = await promptForConfirmation({
    message: "Set as default environment for this layer?",
    default: true,
  });

  printFromLayerPreviewSummary({
    name: input.name,
    layerSelector,
    resolved,
    bind,
  });

  const confirmed = await promptForConfirmation({
    message: "Create environment from this configuration?",
    default: true,
  });
  if (!confirmed) {
    return { status: "cancelled" };
  }

  const result = await runEnvironmentCreate({
    name: input.name,
    fromLayer: layerSelector,
    bind,
    description: input.description,
    fromLayerResolved: resolved,
  });
  return { status: "confirmed", result };
}
