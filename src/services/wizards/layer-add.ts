import { listLayers } from "../../models/layer-model.js";
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
  return listLayers()
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
          { name: "Host plugin pin", value: "plugin_pin" },
          { name: "Layer reference", value: "layer" },
        ],
        default: input.selector?.startsWith("plugin_pin:")
          ? "plugin_pin"
          : input.selector?.startsWith("layer:")
            ? "layer"
            : "resource",
      });

      if (kind === "plugin_pin") {
        const raw = await promptForValue({
          message: "Plugin pin selector (e.g. posthog@cursor-team-kit)",
          default: input.selector,
        });
        return raw.startsWith("plugin_pin:") ? raw : `plugin_pin:${raw}`;
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
      : input.type === "plugin_pin"
        ? "plugin_pin"
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
  const isPluginPin =
    normalizedSelector.startsWith("plugin_pin:") || attachmentType === "plugin_pin";
  const isLayer =
    normalizedSelector.startsWith("layer:") || attachmentType === "layer";

  const version = await resolveOrPrompt({
    value: input.version,
    shouldPrompt:
      input.shouldPrompt && (isPluginPin || isLayer) && !input.version,
    prompt: async () =>
      promptForValue({
        message: "Version constraint (leave empty for latest)",
        default: "",
      }),
  });

  let embed = input.embed;
  if (isPluginPin && input.shouldPrompt && embed === undefined) {
    embed = await promptForConfirmation({
      message: "Embed host plugin on export?",
      default: false,
    });
  }

  return {
    selector: normalizedSelector.startsWith("plugin_pin:") && !normalizedSelector.includes("@")
      ? normalizedSelector
      : isPluginPin && !normalizedSelector.startsWith("plugin_pin:")
        ? `plugin_pin:${normalizedSelector}`
        : isLayer && !normalizedSelector.startsWith("layer:")
          ? `layer:${normalizedSelector}`
          : normalizedSelector,
    type: isPluginPin ? "plugin_pin" : isLayer ? "layer" : parsedSelector.type ?? attachmentType,
    version: version || undefined,
    embed,
  };
}
