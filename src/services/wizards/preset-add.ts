import { listPresets } from "../../models/preset.js";
import { listResources } from "../../models/resource.js";
import { RESOURCE_TYPES } from "../../types.js";
import {
  promptForChoice,
  promptForConfirmation,
  promptForValue,
  resolveOrPrompt,
} from "./shared.js";

export interface PresetAddWizardResult {
  selector?: string;
  type?: string;
  version?: string;
  embed?: boolean;
}

type PresetAddKind = "resource" | "plugin" | "preset-dependency";

function getDefaultKind(
  type: string | undefined,
  selector: string | undefined,
): PresetAddKind {
  if (type === "plugin" || type === "preset-dependency") {
    return type;
  }
  if (selector?.includes("@")) {
    return "plugin";
  }
  return "resource";
}

function getDefaultType(type: string | undefined): string {
  if (type && RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number])) {
    return type;
  }
  return "skill";
}

function getDefaultSelector(type: string | undefined): string | undefined {
  if (!type || type === "plugin" || type === "preset-dependency") {
    return undefined;
  }

  return listResources({ type: type as never })[0]?.id;
}

function getDependencyChoices(currentPresetName: string | undefined) {
  return listPresets()
    .filter((preset) => preset.name !== currentPresetName)
    .map((preset) => ({
      name: `${preset.name}@${preset.version}`,
      value: `${preset.name}@${preset.version}`,
    }));
}

function getResourceChoices(type: string) {
  return listResources({ type: type as never }).map((resource) => ({
    name: `${resource.name} (${resource.id})`,
    value: resource.id,
  }));
}

export async function runPresetAddWizard(input: {
  selector?: string;
  type?: string;
  version?: string;
  embed?: boolean;
  presetName?: string;
  shouldPrompt: boolean;
}): Promise<PresetAddWizardResult> {
  const kind = await resolveOrPrompt<PresetAddKind>({
    value:
      input.type === "plugin" || input.type === "preset-dependency"
        ? input.type
        : input.type
          ? "resource"
          : undefined,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForChoice({
        message: input.presetName
          ? `What do you want to add to "${input.presetName}"?`
          : "What do you want to add?",
        choices: [
          { name: "Resource", value: "resource" },
          { name: "Plugin", value: "plugin" },
          { name: "Dependency on another preset", value: "preset-dependency" },
        ],
        default: getDefaultKind(input.type, input.selector),
      }),
  });

  const type = await resolveOrPrompt({
    value: input.type ?? (kind === "plugin" || kind === "preset-dependency" ? kind : undefined),
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      kind === "resource"
        ? promptForChoice({
            message: "Which resource type?",
            choices: RESOURCE_TYPES.map((resourceType) => ({
              name: resourceType,
              value: resourceType,
            })),
            default: getDefaultType(input.type),
          })
        : Promise.resolve(kind),
  });

  const selector = await resolveOrPrompt({
    value: input.selector,
    shouldPrompt: input.shouldPrompt,
    prompt: async () => {
      if (type === "plugin") {
        return promptForValue({
          message: "Plugin reference",
        });
      }

      if (type === "preset-dependency") {
        const dependencyChoices = getDependencyChoices(input.presetName);
        if (dependencyChoices.length > 0) {
          return promptForChoice({
            message: "Which preset should this depend on?",
            choices: dependencyChoices,
          });
        }
        return promptForValue({
          message: "Dependency preset name",
        });
      }

      const resourceChoices = getResourceChoices(type ?? getDefaultType(input.type));
      if (resourceChoices.length > 0) {
        return promptForChoice({
          message: `Which ${type} should be attached?`,
          choices: resourceChoices,
          default: getDefaultSelector(type),
        });
      }

      return promptForValue({
        message: "Resource name or ID",
      });
    },
  });

  const version = await resolveOrPrompt({
    value: input.version,
    shouldPrompt:
      input.shouldPrompt && (type === "plugin" || type === "preset-dependency"),
    prompt: async () =>
      promptForValue({
        message: type === "plugin"
          ? "Plugin version constraint"
          : "Dependency version constraint",
        default: "^1.0.0",
      }),
  });

  const embed = await resolveOrPrompt({
    value: input.embed,
    shouldPrompt: input.shouldPrompt && type === "plugin",
    prompt: async () =>
      promptForConfirmation({
        message: "Embed plugin files on export?",
        default: false,
      }),
  });

  return { selector, type, version, embed };
}
