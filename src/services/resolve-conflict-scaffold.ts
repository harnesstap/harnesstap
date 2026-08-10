import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import { ensurePluginResource } from "./plugin-composition.js";
import {
  setPluginResourceOverride,
  setPluginVersionOverride,
} from "./plugin-overrides.js";
import {
  promptForChoice,
  promptForConfirmation,
  promptForValue,
  shouldUseWizard,
} from "./wizards/shared.js";
import {
  SingletonConflictError,
  type UnsatisfiableConstraintError,
} from "./resolve/types.js";
import type { Plugin } from "../types.js";
import type { OutputFormat } from "../utils/output-format.js";

export interface ScaffoldCompositionInput {
  name: string;
  dependencies: string[];
  resourceOverrides: Record<string, string>;
  versionOverrides: Record<string, string>;
}

/**
 * Promote an attempted composition into a real, editable plugin whose
 * dependencies are what the user was applying and whose overrides encode the
 * choices they confirmed.
 */
export async function scaffoldCompositionPlugin(
  input: ScaffoldCompositionInput,
): Promise<Plugin> {
  if (getPluginByName(input.name)) {
    throw new Error(`Plugin ${input.name} already exists. Choose another name.`);
  }
  const root = createPlugin({
    name: input.name,
    description: `Composition of ${input.dependencies.join(", ")}`,
  });
  for (const dependency of input.dependencies) {
    const target = resolvePluginSelector(dependency);
    if (!target) {
      throw new Error(`Plugin not found: ${dependency}`);
    }
    const reference = ensurePluginResource(`plugin:${target.name}`);
    addResourceToPlugin(root.id, reference.id);
  }
  for (const [key, winner] of Object.entries(input.resourceOverrides)) {
    setPluginResourceOverride(root.id, key, winner);
  }
  for (const [name, version] of Object.entries(input.versionOverrides)) {
    setPluginVersionOverride(root.id, name, version);
  }
  return root;
}

export interface OfferScaffoldInput {
  error: SingletonConflictError | UnsatisfiableConstraintError;
  attemptedSelectors: string[];
  interactive?: boolean;
  noInteractive?: boolean;
  format: OutputFormat;
}

/**
 * On a TTY run, show the conflict, collect the user's choices, and write a
 * composition plugin. Returns the new plugin name so the caller can re-apply,
 * or undefined when the user declined or the run is not interactive.
 */
export async function offerConflictScaffold(
  input: OfferScaffoldInput,
): Promise<string | undefined> {
  const usable = shouldUseWizard({
    interactive: input.interactive,
    noInteractive: input.noInteractive,
    format: input.format,
    missingRequiredArgs: true,
  });
  if (!usable) {
    return undefined;
  }

  const confirmed = await promptForConfirmation({
    message: "Create a composition plugin that records this choice?",
  });
  if (!confirmed) {
    return undefined;
  }

  const name = await promptForValue({
    message: "Name for the composition plugin",
  });
  if (!name) {
    return undefined;
  }

  const resourceOverrides: Record<string, string> = {};
  const versionOverrides: Record<string, string> = {};

  if (input.error instanceof SingletonConflictError) {
    const choice = await promptForChoice({
      message: `Which plugin should own ${input.error.key}?`,
      choices: input.error.sides.map((side) => ({
        name: `${side.pluginName}@${side.pluginVersion}`,
        value: side.pluginName,
      })),
    });
    if (!choice) return undefined;
    resourceOverrides[input.error.key] = choice;
  } else {
    const choice = await promptForChoice({
      message: `Which version of ${input.error.pluginName} should win?`,
      choices: input.error.available.map((version) => ({
        name: version,
        value: version,
      })),
    });
    if (!choice) return undefined;
    versionOverrides[input.error.pluginName] = choice;
  }

  const created = await scaffoldCompositionPlugin({
    name,
    dependencies: input.attemptedSelectors,
    resourceOverrides,
    versionOverrides,
  });
  return created.name;
}
