import {
  getPlugin,
  getPluginResources,
  listPlugins,
} from "../../../models/plugin-model.js";
import {
  formatResourceSelector,
  listResources,
} from "../../../models/resource.js";
import {
  formatPluginRef,
  listAttachedPluginRefs,
} from "../../../services/plugin-composition.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

function completeCombineAttachments(pluginId: string): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const resource of listResources({ includeComposition: true })) {
    candidates.push({
      value: formatResourceSelector(resource, { includeType: true }),
      description: resource.description || resource.type,
    });
  }

  for (const plugin of listPlugins()) {
    if (plugin.id === pluginId) {
      continue;
    }
    candidates.push({
      value: `plugin:${plugin.name}`,
      description: plugin.version,
    });
  }

  return candidates;
}

function completeUncombineAttachments(pluginId: string): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const resource of getPluginResources(pluginId)) {
    if (resource.type === "plugin") {
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

  for (const pluginRef of listAttachedPluginRefs(pluginId)) {
    candidates.push({
      value: `plugin:${pluginRef.dependency_name}`,
      description: pluginRef.version_constraint || undefined,
    });
  }

  return candidates;
}

export function completePluginEditAddAttachment(ctx: CompletionContext): CompletionCandidate[] {
  return completePluginAttachmentCandidates(ctx, "add");
}

export function completePluginEditRemoveAttachment(ctx: CompletionContext): CompletionCandidate[] {
  return completePluginAttachmentCandidates(ctx, "remove");
}

function completePluginAttachmentCandidates(
  ctx: CompletionContext,
  mode: "add" | "remove",
): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  const pluginSelector = ctx.consumedPositionals?.[0];
  if (!pluginSelector) {
    return [];
  }

  try {
    const plugin = getPlugin(pluginSelector);
    if (!plugin) {
      return [];
    }

    const candidates = mode === "remove"
      ? completeUncombineAttachments(plugin.id)
      : completeCombineAttachments(plugin.id);

    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}

/** @deprecated Use completePluginEditAddAttachment / completePluginEditRemoveAttachment */
export function completePluginAttachment(ctx: CompletionContext): CompletionCandidate[] {
  const mode = ctx.flag === "remove" ? "remove" : "add";
  return completePluginAttachmentCandidates(ctx, mode);
}
