import {
  addResourceToPlugin,
  removeResourceFromPlugin,
  syncClaudeLayerPluginsAfterAdd,
  syncClaudeLayerPluginsAfterRemove,
} from "../models/plugin-component.js";
import { resolveResource } from "../models/resource.js";
import { parseResourceSelector } from "./resource-selector.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import {
  ensureLayerResource,
  ensurePluginResource,
  formatPluginRef,
  listAttachedPluginPins,
  resolveAttachmentType,
} from "./composition-resource.js";
import { syncPluginResource } from "./resource-sync.js";
import type { Layer, ResourceType } from "../types.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";

export const LAYER_ATTACHMENT_TYPES = [
  ...MATERIAL_RESOURCE_TYPES,
  "plugin",
  "layer",
] as const;

const LAYER_ATTACHMENT_TYPE_ALIASES = [
  ...LAYER_ATTACHMENT_TYPES,
  "layer-dependency",
] as const;

export type LayerAttachmentType = (typeof LAYER_ATTACHMENT_TYPES)[number];

export function validateLayerAttachmentType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  if (type === "layer-dependency") {
    return "layer";
  }
  if (!(LAYER_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid --type. Valid: ${LAYER_ATTACHMENT_TYPE_ALIASES.join(", ")}`,
    );
  }
  return type;
}

interface AddLayerAttachmentInput {
  layer: Layer;
  selector: string;
  type?: string;
  version?: string;
  embed?: boolean;
  sync?: boolean;
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

function resolveTypedResource(selector: string, type: ResourceType) {
  const resourceResult = resolveResource(selector, { mode: "compose" });
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

function normalizeLegacyType(type: string | undefined): string | undefined {
  if (type === "layer-dependency") {
    return "layer";
  }
  return type;
}

function normalizeAttachmentSelector(selector: string, explicitType?: string): string {
  if (selector.includes(":")) {
    return selector.replace(/^layer-dependency:/, "layer:");
  }
  const type = normalizeLegacyType(explicitType);
  if (type === "plugin") {
    return `plugin:${selector}`;
  }
  if (type === "layer") {
    return `layer:${selector}`;
  }
  if (
    type &&
    (MATERIAL_RESOURCE_TYPES as readonly string[]).includes(type as ResourceType)
  ) {
    return selector;
  }
  if (type) {
    return `${type}:${selector}`;
  }
  return selector;
}

export async function addLayerAttachment(input: AddLayerAttachmentInput): Promise<string> {
  const explicitType = normalizeLegacyType(input.type);
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType);

  if (attachmentType === "plugin") {
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const resource = ensurePluginResource(selector, {
      versionConstraint: input.version,
      portable: input.embed ? "embed" : undefined,
    });
    addResourceToPlugin(input.layer.id, resource.id);
    const ref = formatPluginRef(resource);
    if (input.version) {
      syncClaudeLayerPluginsAfterAdd(input.layer, ref, input.version);
    }
    if (input.sync) {
      await syncPluginResource(resource, { policy: "overwrite" });
    }
    const versionLabel = input.version ? ` (${input.version})` : "";
    return `Attached plugin ${ref}${versionLabel} to layer ${input.layer.name}`;
  }

  if (attachmentType === "layer") {
    if (input.embed) {
      throw new Error("--embed is only supported for plugin attachments");
    }
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const resource = ensureLayerResource(selector, {
      versionConstraint: input.version,
    });
    addResourceToPlugin(input.layer.id, resource.id);
    const versionLabel = input.version ? ` (${input.version})` : "";
    return `Attached layer ${resource.name}${versionLabel} to layer ${input.layer.name}`;
  }

  if (input.version) {
    throw new Error("--version is only supported for plugin and layer attachments");
  }
  if (input.embed) {
    throw new Error("--embed is only supported for plugin attachments");
  }
  if (input.sync) {
    throw new Error("--sync is only supported for plugin attachments");
  }

  const resource = resolveTypedResource(selector, attachmentType);
  addResourceToPlugin(input.layer.id, resource.id);
  return `Added ${resource.type} "${resource.name}" to layer ${input.layer.name}`;
}

export function removeLayerAttachment(input: RemoveLayerAttachmentInput): {
  message: string;
  removed: boolean;
} {
  const explicitType = normalizeLegacyType(input.type);
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType);

  if (attachmentType === "plugin") {
    const parsed = parseResourceSelector(selector);
    const ref = parsed.namespace ? `${parsed.name}@${parsed.namespace}` : parsed.name;
    const pin = listAttachedPluginPins(input.layer.id).find((entry) => entry.ref === ref);
    if (!pin) {
      throw new Error(`Plugin pin not found: ${ref}`);
    }
    removeResourceFromPlugin(input.layer.id, pin.resource.id);
    syncClaudeLayerPluginsAfterRemove(input.layer, pin.ref);
    return {
      removed: true,
      message: `Removed plugin ${pin.ref} from layer ${input.layer.name}`,
    };
  }

  if (attachmentType === "layer") {
    const resourceResult = resolveResource(selector, { mode: "compose" });
    if (resourceResult.status === "not_found") {
      const depName = parseResourceSelector(selector).name;
      return {
        removed: false,
        message: `Layer dependency "${depName}" not found on layer ${input.layer.name}`,
      };
    }
    if (resourceResult.status === "ambiguous") {
      throw new Error(formatAmbiguousResourceMessage(selector, resourceResult.matches));
    }
    if (resourceResult.resource.type !== "layer") {
      throw new Error(
        `Type mismatch: selector "${selector}" resolved to ${resourceResult.resource.type}, expected layer`,
      );
    }
    removeResourceFromPlugin(input.layer.id, resourceResult.resource.id);
    return {
      removed: true,
      message: `Removed layer ${resourceResult.resource.name} from layer ${input.layer.name}`,
    };
  }

  const resource = resolveTypedResource(selector, attachmentType);
  removeResourceFromPlugin(input.layer.id, resource.id);
  return {
    removed: true,
    message: `Removed ${resource.type} "${resource.name}" from layer ${input.layer.name}`,
  };
}
