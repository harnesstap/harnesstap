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
  ENVIRONMENT_CREATE_SOURCE_CHOICES,
  promptForProjectLayerScope,
} from "./environment-create-project-scope.js";
import {
  isPromptBackError,
  promptForChoice,
  promptForConfirmation,
  promptForSearchableChoice,
  promptForValue,
  withPromptBack,
} from "./shared.js";

export type EnvironmentCreateSource = "from-project" | "from-layer" | "blank";

export type EnvironmentCreateWizardOutcome = {
  status: "confirmed";
  result: EnvironmentCreateResult;
};

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
    let selectedProcessKeys: string[];
    try {
      selectedProcessKeys = await promptForSearchableMultiSelect({
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
    } catch (error) {
      if (isPromptBackError(error)) {
        throw error;
      }
      throw error;
    }

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
  console.log(`Imported values: ${Object.keys(preview.values).length}`);
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
  while (true) {
    const source = await promptForChoice<EnvironmentCreateSource>({
      message: "How should this environment be created?",
      choices: ENVIRONMENT_CREATE_SOURCE_CHOICES,
      default: "from-project",
    });

    if (source === "blank") {
      const description = await promptOptionalDescription(input.description);
      const confirmed = await promptForConfirmation({
        message: `Create blank environment ${input.name}?`,
        default: true,
      });
      if (!confirmed) {
        continue;
      }

      const result = await runEnvironmentCreate({
        name: input.name,
        blank: true,
        description,
      });
      return { status: "confirmed", result };
    }

    if (source === "from-project") {
      let scope: { projectRoot: string; layerSelectors: string[] } | undefined;
      try {
        scope = await promptForProjectLayerScope();
      } catch (error) {
        if (isPromptBackError(error)) {
          continue;
        }
        throw error;
      }
      if (!scope) {
        continue;
      }

      const { projectRoot, layerSelectors } = scope;

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
        continue;
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

    let layerSelector: string | undefined;
    let resolved: EnvironmentFromLayerResolved | undefined;

    while (true) {
      try {
        layerSelector = await withPromptBack(() =>
          promptForSearchableChoice({
            message: "Layer whose requirements should seed this environment",
            choices: toLayerChoices(),
          }),
        );
      } catch (error) {
        if (isPromptBackError(error)) {
          layerSelector = undefined;
          break;
        }
        throw error;
      }

      try {
        resolved = await collectFromLayerResolutions({ layerSelector });
        break;
      } catch (error) {
        if (isPromptBackError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!layerSelector || !resolved) {
      continue;
    }
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
      continue;
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
}
