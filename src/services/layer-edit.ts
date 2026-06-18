import {
  getLayerResources,
  listLayers,
  setLayerResourceOrder,
  touchLayerUpdatedAt,
} from "../models/layer-model.js";
import { listResources } from "../models/resource.js";
import type { Layer, Resource } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";
import { sortResourcesByUpdatedAt, toResourceListRows } from "../ui/resource-list-render.js";
import {
  addLayerAttachment,
  listAttachedLayerRefs,
  listAttachedPluginPins,
  removeLayerAttachment,
} from "./layer-composition.js";
import { validateLayerDependencyGraph } from "./layer-resolver.js";

export type LayerEditRow = Resource & {
  namespace: string;
  display_name: string;
  checked: boolean;
  version_constraint?: string;
};

export interface LayerEditDiff {
  added: LayerEditRow[];
  removed: LayerEditRow[];
}

export interface LayerEditApplyResult {
  added: string[];
  removed: string[];
}

export function attachmentKey(
  resource: Pick<Resource, "type" | "name" | "namespace">,
): string {
  if (resource.namespace) {
    return `${resource.type}:${resource.name}@${resource.namespace}`;
  }
  return `${resource.type}:${resource.name}`;
}

export function sortLayerEditRowsForDisplay(rows: LayerEditRow[]): LayerEditRow[] {
  return [...rows].sort((left, right) => {
    if (left.checked !== right.checked) {
      return left.checked ? -1 : 1;
    }
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

function layerRowFromLayer(
  layer: Layer,
  checked: boolean,
  constraint = "latest",
): LayerEditRow {
  return {
    id: `layer-candidate:${layer.id}`,
    type: "layer",
    name: layer.name,
    namespace: constraint,
    description: layer.description ?? "",
    source: "composition:layer",
    origin_kind: "manual",
    origin_ref: layer.name,
    content_hash: "",
    content: "{}",
    metadata: { version_constraint: constraint },
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    display_name: `${layer.name}@${layer.version}`,
    checked,
    version_constraint: constraint,
  };
}

export function buildLayerEditCandidates(target: Layer): LayerEditRow[] {
  const attached = getLayerResources(target.id);
  const attachedKeys = new Set(attached.map(attachmentKey));
  const attachedConstraints = new Map<string, string>();

  for (const pin of listAttachedPluginPins(target.id)) {
    attachedConstraints.set(
      attachmentKey(pin.resource),
      pin.version_constraint || "latest",
    );
  }
  for (const ref of listAttachedLayerRefs(target.id)) {
    attachedConstraints.set(
      attachmentKey(ref.resource),
      ref.version_constraint || "latest",
    );
  }

  const attachedLayerNames = new Set(
    attached
      .filter((resource) => resource.type === "layer")
      .map((resource) => resource.name),
  );

  const materialAndPins = listResources({ includeComposition: true }).filter(
    (resource) => resource.type !== "layer",
  );

  const byId = new Map<string, LayerEditRow>();
  for (const row of toResourceListRows(materialAndPins)) {
    const key = attachmentKey(row);
    byId.set(row.id, {
      ...row,
      checked: attachedKeys.has(key),
      version_constraint: attachedConstraints.get(key),
    });
  }

  for (const attachedResource of attached) {
    if (!byId.has(attachedResource.id)) {
      const row = toResourceListRows([attachedResource])[0];
      if (!row) {
        continue;
      }
      const key = attachmentKey(row);
      byId.set(attachedResource.id, {
        ...row,
        checked: true,
        version_constraint: attachedConstraints.get(key),
      });
    }
  }

  for (const layer of listLayers()) {
    if (layer.id === target.id) {
      continue;
    }
    const existing = [...byId.values()].find(
      (row) => row.type === "layer" && row.name === layer.name,
    );
    if (existing) {
      continue;
    }
    const key = `layer:${layer.name}`;
    byId.set(
      `layer-candidate:${layer.id}`,
      layerRowFromLayer(
        layer,
        attachedLayerNames.has(layer.name) || attachedKeys.has(key),
        attachedConstraints.get(key) ?? "latest",
      ),
    );
  }

  return [...byId.values()];
}

export function computeLayerEditDiff(
  initial: LayerEditRow[],
  pending: LayerEditRow[],
): LayerEditDiff {
  const initialChecked = new Map(
    initial.filter((row) => row.checked).map((row) => [attachmentKey(row), row]),
  );
  const pendingChecked = new Map(
    pending.filter((row) => row.checked).map((row) => [attachmentKey(row), row]),
  );

  const added = [...pendingChecked.entries()]
    .filter(([key]) => !initialChecked.has(key))
    .map(([, row]) => row);
  const removed = [...initialChecked.entries()]
    .filter(([key]) => !pendingChecked.has(key))
    .map(([, row]) => row);

  return { added, removed };
}

export function validateLayerEditSelection(
  target: Layer,
  pending: LayerEditRow[],
): void {
  for (const row of pending) {
    if (!row.checked) {
      continue;
    }
    if (row.type === "layer" && row.name === target.name) {
      throw new Error(`Layer "${target.name}" cannot reference itself`);
    }
  }

  const dependencyNames = pending
    .filter((row) => row.checked && row.type === "layer")
    .map((row) => row.name);
  validateLayerDependencyGraph(target.name, dependencyNames);
}

function resolveAttachmentSelector(row: LayerEditRow): string {
  if (row.type === "plugin_pin") {
    return row.namespace ? `${row.name}@${row.namespace}` : row.name;
  }
  if (row.type === "layer") {
    return row.name;
  }
  return row.namespace ? `${row.name}@${row.namespace}` : row.name;
}

function computePersistedResourceOrder(resources: Resource[]): string[] {
  const ordered: Resource[] = [];
  for (const type of RESOURCE_TYPES) {
    ordered.push(
      ...sortResourcesByUpdatedAt(
        resources.filter((resource) => resource.type === type),
      ),
    );
  }
  return ordered.map((resource) => resource.id);
}

export async function applyLayerEdit(input: {
  layer: Layer;
  initial: LayerEditRow[];
  pending: LayerEditRow[];
  dryRun?: boolean;
}): Promise<LayerEditApplyResult> {
  const diff = computeLayerEditDiff(input.initial, input.pending);
  validateLayerEditSelection(input.layer, input.pending);

  if (input.dryRun) {
    return {
      added: diff.added.map(attachmentKey),
      removed: diff.removed.map(attachmentKey),
    };
  }

  for (const row of diff.removed) {
    removeLayerAttachment({
      layer: input.layer,
      selector: resolveAttachmentSelector(row),
      type: row.type,
    });
  }

  for (const row of diff.added) {
    if (row.type === "plugin_pin" || row.type === "layer") {
      await addLayerAttachment({
        layer: input.layer,
        selector: resolveAttachmentSelector(row),
        type: row.type,
        version: row.version_constraint ?? "latest",
      });
      continue;
    }

    await addLayerAttachment({
      layer: input.layer,
      selector: resolveAttachmentSelector(row),
      type: row.type,
    });
  }

  const remaining = getLayerResources(input.layer.id);
  setLayerResourceOrder(
    input.layer.id,
    computePersistedResourceOrder(remaining),
  );
  touchLayerUpdatedAt(input.layer.id);

  return {
    added: diff.added.map(attachmentKey),
    removed: diff.removed.map(attachmentKey),
  };
}
