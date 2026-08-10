import { getLayer } from "../../models/plugin-model.js";
import type { Layer } from "../../types.js";
import type { ResourceType } from "../../types.js";
import { buildLayerEditCandidates, type LayerEditRow } from "../layer-edit.js";
import { promptForInteractiveLayerEdit } from "./interactive-layer-edit.js";

function formatLayerLabel(layer: Pick<Layer, "name" | "version">): string {
  return `${layer.name}@${layer.version}`;
}

export async function runLayerEditWizard(input: {
  layer: Layer;
  typeFilter?: ResourceType;
  search?: string;
  showId?: boolean;
  showAll?: boolean;
}): Promise<LayerEditRow[] | undefined> {
  const initial = buildLayerEditCandidates(input.layer);
  const result = await promptForInteractiveLayerEdit({
    message: `Edit layer ${formatLayerLabel(input.layer)}`,
    rows: initial,
    typeFilter: input.typeFilter,
    initialQuery: input.search,
    showId: input.showId,
    showAll: input.showAll,
  });
  return result.rows;
}

export type { LayerEditRow } from "../layer-edit.js";

export function buildLayerEditSnapshot(layerName: string): LayerEditRow[] {
  const layer = getLayer(layerName);
  if (!layer) {
    throw new Error(`Layer not found: ${layerName}`);
  }
  return buildLayerEditCandidates(layer);
}
