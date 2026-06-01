import {
  addResourceToLayer,
  removeResourceFromLayer,
  syncClaudeLayerPluginsAfterAdd,
  syncClaudeLayerPluginsAfterRemove,
  addDependencyToLayer,
  removeDependencyFromLayer,
} from "../models/layer.js";
import { addPluginToLayer, removePluginFromLayer } from "../models/plugin.js";
import { resolveResource } from "../models/resource.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import type { Layer, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";

export const LAYER_ATTACHMENT_TYPES = [
  ...RESOURCE_TYPES,
  "plugin",
  "layer-dependency",
] as const;

export type LayerAttachmentType = (typeof LAYER_ATTACHMENT_TYPES)[number];

interface AddLayerAttachmentInput {
  layer: Layer;
  selector: string;
  type?: string;
  version?: string;
  embed?: boolean;
}

interface RemoveLayerAttachmentInput {
  layer: Layer;
  selector: string;
  type?: string;
}

function formatAmbiguousResourceMessage(
  selector: string,
  matches: Array<{ id: string; type: string; name: string }>,
): string {
  return [
    `Ambiguous resource name: ${selector}`,
    ...matches.map((match) => `  ${match.id} ${match.type.padEnd(14)} ${match.name}`),
  ].join("\n");
}

function formatTypeRequirement(): string {
  return `--type is required (one of: ${LAYER_ATTACHMENT_TYPES.join(", ")})`;
}

function parseAttachmentType(type: string | undefined): LayerAttachmentType {
  if (!type) {
    throw new Error(formatTypeRequirement());
  }

  if (!LAYER_ATTACHMENT_TYPES.includes(type as LayerAttachmentType)) {
    throw new Error(`Invalid --type. Valid: ${LAYER_ATTACHMENT_TYPES.join(", ")}`);
  }

  return type as LayerAttachmentType;
}

function assertNoVersion(_type: ResourceType, version: string | undefined): void {
  if (version) {
    throw new Error("--version is only supported for --type plugin and --type layer-dependency");
  }
}

function assertNoEmbed(_type: LayerAttachmentType, embed: boolean | undefined): void {
  if (embed) {
    throw new Error("--embed is only supported for --type plugin");
  }
}

function resolveTypedResource(selector: string, type: ResourceType) {
  const resourceResult = resolveResource(selector);
  if (resourceResult.status === "not_found") {
    throw new Error(`Resource not found: ${selector}`);
  }
  if (resourceResult.status === "ambiguous") {
    throw new Error(formatAmbiguousResourceMessage(selector, resourceResult.matches));
  }
  if (resourceResult.resource.type !== type) {
    throw new Error(
      `Type mismatch: selector "${selector}" resolved to ${resourceResult.resource.type}, expected ${type}`,
    );
  }
  return resourceResult.resource;
}

export function addLayerAttachment(input: AddLayerAttachmentInput): string {
  const type = parseAttachmentType(input.type);

  if (RESOURCE_TYPES.includes(type as ResourceType)) {
    assertNoVersion(type as ResourceType, input.version);
    assertNoEmbed(type, input.embed);
    const resource = resolveTypedResource(input.selector, type as ResourceType);
    addResourceToLayer(input.layer.id, resource.id);
    return `Added ${resource.type} "${resource.name}" to layer ${input.layer.name}`;
  }

  if (type === "plugin") {
    if (!input.version) {
      throw new Error("--version is required for --type plugin");
    }
    parseVersionConstraint(input.version);
    addPluginToLayer(input.layer.id, input.selector, input.version, {
      embedOnExport: Boolean(input.embed),
    });
    syncClaudeLayerPluginsAfterAdd(input.layer, input.selector, input.version);
    return `Pinned ${input.selector} (${input.version}) on layer ${input.layer.name}`;
  }

  if (!input.version) {
    throw new Error("--version is required for --type layer-dependency");
  }
  assertNoEmbed(type, input.embed);
  parseVersionConstraint(input.version);
  addDependencyToLayer(input.layer.id, input.selector, input.version);
  return `Added dependency ${input.selector} (${input.version}) to layer ${input.layer.name}@${input.layer.version}`;
}

export function removeLayerAttachment(input: RemoveLayerAttachmentInput): {
  message: string;
  removed: boolean;
} {
  const type = parseAttachmentType(input.type);

  if (RESOURCE_TYPES.includes(type as ResourceType)) {
    const resource = resolveTypedResource(input.selector, type as ResourceType);
    removeResourceFromLayer(input.layer.id, resource.id);
    return {
      removed: true,
      message: `Removed ${resource.type} "${resource.name}" from layer ${input.layer.name}`,
    };
  }

  if (type === "plugin") {
    removePluginFromLayer(input.layer.id, input.selector);
    syncClaudeLayerPluginsAfterRemove(input.layer, input.selector);
    return {
      removed: true,
      message: `Removed plugin pin ${input.selector} from layer ${input.layer.name}`,
    };
  }

  const removed = removeDependencyFromLayer(input.layer.id, input.selector);
  return {
    removed,
    message: removed
      ? `Removed dependency ${input.selector} from layer ${input.layer.name}@${input.layer.version}`
      : `Dependency "${input.selector}" not found on layer ${input.layer.name}@${input.layer.version}`,
  };
}
