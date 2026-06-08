import { listPlugins } from "../../models/plugin-component.js";
import { listResources } from "../../models/resource.js";
import { LISTABLE_RESOURCE_TYPES, MATERIAL_RESOURCE_TYPES } from "../../types.js";
import { parseResourceSelector } from "../resource-selector.js";
import type { ResourceType } from "../../types.js";
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

function getLayerChoices(currentLayerName: string | undefined) {
  return listPlugins()
    .filter((layer) => layer.name !== currentLayerName)
    .map((layer) => ({
      name: `${layer.name}@${layer.version}`,
      value: `layer:${layer.name}`,
    }));
}

function getResourceChoices(type: string) {
  return listResources({ type: type as never }).map((resource) => {
    const label = resource.namespace
      ? `${resource.name}@${resource.namespace}`
      : resource.name;
    return {
      name: label,
      value: `${type}:${label}`,
    };
  });
}

export async function runLayerAddWizard(input: {
  selector?: string;
  type?: string;
  version?: string;
  embed?: boolean;
  layerName?: string;
  shouldPrompt: boolean;
}): Promise<LayerAddWizardResult> {
  const selector = await resolveOrPrompt({
    value: input.selector,
    shouldPrompt: input.shouldPrompt,
    prompt: async () => {
      const kind = await promptForChoice({
        message: input.layerName
          ? `What do you want to add to "${input.layerName}"?`
          : "What do you want to add?",
        choices: [
          { name: "Resource", value: "resource" },
          { name: "Plugin reference", value: "plugin" },
          { name: "Layer reference", value: "layer" },
        ],
        default: input.selector?.startsWith("plugin:")
          ? "plugin"
          : input.selector?.startsWith("layer:")
            ? "layer"
            : "resource",
      });

      if (kind === "plugin") {
        const raw = await promptForValue({
          message: "Plugin selector (e.g. posthog@cursor-team-kit)",
          default: input.selector,
        });
        return raw.startsWith("plugin:") ? raw : `plugin:${raw}`;
      }

      if (kind === "layer") {
        const choices = getLayerChoices(input.layerName);
        if (choices.length === 0) {
          return promptForValue({
            message: "Layer name",
          });
        }
        return promptForChoice({
          message: "Which layer?",
          choices,
        });
      }

      const type = await promptForChoice({
        message: "Which resource type?",
        choices: LISTABLE_RESOURCE_TYPES.map((type) => ({
          name: type,
          value: type,
        })),
        default: input.type ?? "skill",
      });

      const choices = getResourceChoices(type);
      if (choices.length > 0) {
        return promptForChoice({
          message: `Which ${type}?`,
          choices,
        });
      }

      return promptForValue({
        message: `${type} selector`,
      });
    },
  });

  if (!selector) {
    return {};
  }

  const attachmentType =
    input.type === "layer-dependency"
      ? "layer"
      : input.type === "plugin"
        ? "plugin"
        : input.type;

  const isMaterialType =
    attachmentType &&
    (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(attachmentType as ResourceType);

  const normalizedSelector = selector.includes(":")
    ? selector.replace(/^layer-dependency:/, "layer:")
    : attachmentType && !isMaterialType
      ? `${attachmentType}:${selector}`
      : selector;

  const parsedSelector = parseResourceSelector(normalizedSelector);
  const isPlugin =
    normalizedSelector.startsWith("plugin:") || attachmentType === "plugin";
  const isLayer =
    normalizedSelector.startsWith("layer:") || attachmentType === "layer";

  const version = await resolveOrPrompt({
    value: input.version,
    shouldPrompt:
      input.shouldPrompt && (isPlugin || isLayer) && !input.version,
    prompt: async () =>
      promptForValue({
        message: "Version constraint (leave empty for latest)",
        default: "",
      }),
  });

  let embed = input.embed;
  if (isPlugin && input.shouldPrompt && embed === undefined) {
    embed = await promptForConfirmation({
      message: "Embed plugin on export?",
      default: false,
    });
  }

  return {
    selector: normalizedSelector.startsWith("plugin:") && !normalizedSelector.includes("@")
      ? normalizedSelector
      : isPlugin && !normalizedSelector.startsWith("plugin:")
        ? `plugin:${normalizedSelector}`
        : isLayer && !normalizedSelector.startsWith("layer:")
          ? `layer:${normalizedSelector}`
          : normalizedSelector,
    type: isPlugin ? "plugin" : isLayer ? "layer" : parsedSelector.type ?? attachmentType,
    version: version || undefined,
    embed,
  };
}
