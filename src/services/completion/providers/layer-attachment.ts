import {
  getLayer,
  getLayerResources,
  listLayers,
} from "../../../models/layer-model.js";
import {
  formatResourceSelector,
  listResources,
} from "../../../models/resource.js";
import {
  formatPluginRef,
  listAttachedLayerRefs,
} from "../../../services/layer-composition.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

function completeCombineAttachments(layerId: string): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const resource of listResources({ includeComposition: true })) {
    candidates.push({
      value: formatResourceSelector(resource, { includeType: true }),
      description: resource.description || resource.type,
    });
  }

  for (const layer of listLayers()) {
    if (layer.id === layerId) {
      continue;
    }
    candidates.push({
      value: `layer:${layer.name}`,
      description: layer.version,
    });
  }

  return candidates;
}

function completeUncombineAttachments(layerId: string): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const resource of getLayerResources(layerId)) {
    if (resource.type === "plugin_pin") {
      candidates.push({
        value: formatResourceSelector(resource, { includeType: true }),
        description: formatPluginRef(resource),
      });
      continue;
    }
    candidates.push({
      value: formatResourceSelector(resource, { includeType: true }),
      description: resource.description || resource.type,
    });
  }

  for (const layerRef of listAttachedLayerRefs(layerId)) {
    candidates.push({
      value: `layer:${layerRef.dependency_name}`,
      description: layerRef.version_constraint || undefined,
    });
  }

  return candidates;
}

export function completeLayerEditAddAttachment(ctx: CompletionContext): CompletionCandidate[] {
  return completeLayerAttachmentCandidates(ctx, "add");
}

export function completeLayerEditRemoveAttachment(ctx: CompletionContext): CompletionCandidate[] {
  return completeLayerAttachmentCandidates(ctx, "remove");
}

function completeLayerAttachmentCandidates(
  ctx: CompletionContext,
  mode: "add" | "remove",
): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  const layerSelector = ctx.consumedPositionals?.[0];
  if (!layerSelector) {
    return [];
  }

  try {
    const layer = getLayer(layerSelector);
    if (!layer) {
      return [];
    }

    const candidates = mode === "remove"
      ? completeUncombineAttachments(layer.id)
      : completeCombineAttachments(layer.id);

    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}

/** @deprecated Use completeLayerEditAddAttachment / completeLayerEditRemoveAttachment */
export function completeLayerAttachment(ctx: CompletionContext): CompletionCandidate[] {
  const mode = ctx.flag === "remove" ? "remove" : "add";
  return completeLayerAttachmentCandidates(ctx, mode);
}
