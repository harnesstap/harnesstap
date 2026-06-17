import { listDecks } from "../../models/deck.js";
import { listLayers } from "../../models/layer-model.js";
import {
  formatResourceSelector,
  listResources,
} from "../../models/resource.js";
import type { PromptChoice } from "../wizards/shared.js";

export function toLayerChoices(): PromptChoice[] {
  return listLayers().map((layer) => ({
    name: `${layer.name}@${layer.version}`,
    value: `${layer.name}@${layer.version}`,
    description: layer.description || undefined,
  }));
}

export function toDeckChoices(): PromptChoice[] {
  return listDecks().map((deck) => ({
    name: deck.name,
    value: deck.name,
    description: deck.root_path || undefined,
  }));
}

export function toResourceChoices(): PromptChoice[] {
  return listResources().map((resource) => ({
    name: formatResourceSelector(resource),
    value: formatResourceSelector(resource),
    description: resource.type,
  }));
}
