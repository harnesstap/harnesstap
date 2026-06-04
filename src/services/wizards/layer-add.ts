import { listPlugins } from "../../models/plugin-component.js";
import { listResources } from "../../models/resource.js";
import { RESOURCE_TYPES } from "../../types.js";
import {
  promptForChoice,
  promptForConfirmation,
  promptForValue,
  resolveOrPrompt,
} from "./shared.js";

export interface LayerAddWizardResult {
  selector?: string;
  type?: string;
  version?: string;
  embed?: boolean;
}

type LayerAddKind = "resource" | "plugin" | "layer-dependency";

function getDefaultKind(
  type: string | undefined,
  selector: string | undefined,
): LayerAddKind {
  if (type === "plugin" || type === "layer-dependency") {
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
  if (!type || type === "plugin" || type === "layer-dependency") {
    return undefined;
  }

  return listResources({ type: type as never })[0]?.id;
}

function getDependencyChoices(currentLayerName: string | undefined) {
  return listPlugins()
    .filter((layer) => layer.name !== currentLayerName)
    .map((layer) => ({
      name: `${layer.name}@${layer.version}`,
      value: `${layer.name}@${layer.version}`,
    }));
}

function getResourceChoices(type: string) {
  return listResources({ type: type as never }).map((resource) => ({
    name: resource.name,
    value: resource.id,
  }));
}

export async function runLayerAddWizard(input: {
  selector?: string;
  type?: string;
  version?: string;
  embed?: boolean;
  layerName?: string;
  shouldPrompt: boolean;
}): Promise<LayerAddWizardResult> {
  const kind = await resolveOrPrompt<LayerAddKind>({
    value:
      input.type === "plugin" || input.type === "layer-dependency"
        ? input.type
        : input.type
          ? "resource"
          : undefined,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForChoice({
        message: input.layerName
          ? `What do you want to add to "${input.layerName}"?`
          : "What do you want to add?",
        choices: [
          { name: "Resource", value: "resource" },
          { name: "Plugin", value: "plugin" },
          { name: "Dependency on another layer", value: "layer-dependency" },
        ],
        default: getDefaultKind(input.type, input.selector),
      }),
  });

  const type = await resolveOrPrompt({
    value: input.type ?? (kind === "plugin" || kind === "layer-dependency" ? kind : undefined),
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

      if (type === "layer-dependency") {
        const dependencyChoices = getDependencyChoices(input.layerName);
        if (dependencyChoices.length > 0) {
          return promptForChoice({
            message: "Which layer should this depend on?",
            choices: dependencyChoices,
          });
        }
        return promptForValue({
          message: "Dependency layer name",
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
      input.shouldPrompt && (type === "plugin" || type === "layer-dependency"),
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
