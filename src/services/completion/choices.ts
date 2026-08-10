import { listPlugins } from "../../models/plugin-model.js";
import {
  formatResourceSelector,
  listResources,
} from "../../models/resource.js";
import type { PromptChoice } from "../wizards/shared.js";

export function toPluginChoices(): PromptChoice[] {
  return listPlugins().map((plugin) => ({
    name: `${plugin.name}@${plugin.version}`,
    value: `${plugin.name}@${plugin.version}`,
    description: plugin.description || undefined,
  }));
}

export function toResourceChoices(): PromptChoice[] {
  return listResources().map((resource) => ({
    name: formatResourceSelector(resource),
    value: formatResourceSelector(resource),
    description: resource.type,
  }));
}
