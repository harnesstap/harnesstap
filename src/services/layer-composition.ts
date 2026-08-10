import {
  addResourceToLayer,
  removeResourceFromLayer,
  syncClaudeLayerPluginsAfterAdd,
  syncClaudeLayerPluginsAfterRemove,
} from "../models/layer-model.js";
import { findResourceByKey, resolveResource } from "../models/resource.js";
import { markLayerDirty } from "./layer-versioning.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import {
  addDependency,
  ensureDependencyResource,
  listDependencies,
  parseDependencyRef,
  removeDependency,
} from "./plugin-dependency.js";
import { parseResourceSelector } from "./resource-selector.js";
import { syncPluginResource } from "./resource-sync.js";
import type { Layer, Resource, ResourceType } from "../types.js";
import {
  COMPOSITION_RESOURCE_TYPES,
  LISTABLE_RESOURCE_TYPES,
  MATERIAL_RESOURCE_TYPES,
  RESOURCE_TYPES,
} from "../types.js";

export { COMPOSITION_RESOURCE_TYPES, LISTABLE_RESOURCE_TYPES, MATERIAL_RESOURCE_TYPES };

export interface PluginPinView {
  ref: string;
  version_constraint: string;
  embed_on_export: boolean;
  resource: Resource;
}

export interface LayerRefView {
  dependency_name: string;
  version_constraint: string;
  resource: Resource;
}

export function isCompositionResourceType(type: string): boolean {
  return (COMPOSITION_RESOURCE_TYPES as readonly string[]).includes(type);
}

export function pluginResourceNamespace(
  identity: ReturnType<typeof parsePluginRef>,
  versionConstraint?: string,
): string {
  if (!versionConstraint) {
    return identity.namespace;
  }
  if (identity.namespace) {
    return `${identity.namespace}#${versionConstraint}`;
  }
  return versionConstraint;
}

export function formatPluginRef(
  resource: Pick<Resource, "name" | "namespace" | "origin_ref">,
): string {
  if (resource.origin_ref) {
    return resource.origin_ref;
  }
  return resource.namespace ? `${resource.name}@${resource.namespace}` : resource.name;
}

export function findPluginResourceByPin(
  ref: string,
  versionConstraint?: string,
): Resource | undefined {
  const identity = parsePluginRef(ref);
  const withConstraint = findResourceByKey(
    "plugin",
    identity.name,
    pluginResourceNamespace(identity, versionConstraint),
  );
  if (withConstraint) {
    return withConstraint;
  }
  if (!versionConstraint) {
    return findResourceByKey("plugin", identity.name, identity.namespace);
  }
  return undefined;
}

/** @deprecated Prefer parseDependencyRef from plugin-dependency.ts */
export function parsePluginRef(ref: string): {
  name: string;
  namespace: string;
  origin_ref: string;
} {
  const parsed = parseDependencyRef(ref);
  return {
    name: parsed.name,
    namespace: parsed.namespace,
    origin_ref: parsed.origin_ref,
  };
}

function stripTypePrefix(selector: string): string {
  const colonIndex = selector.indexOf(":");
  if (colonIndex === -1) {
    return selector;
  }
  const type = selector.slice(0, colonIndex);
  if (
    type === "plugin" ||
    type === "plugin_pin" ||
    type === "layer" ||
    (RESOURCE_TYPES as readonly string[]).includes(type)
  ) {
    return selector.slice(colonIndex + 1);
  }
  return selector;
}

/** @deprecated Use ensureDependencyResource */
export function ensurePluginResource(
  selector: string,
  opts?: {
    versionConstraint?: string;
    portable?: "reference" | "embed";
  },
): Resource {
  const ref = stripTypePrefix(selector);
  return ensureDependencyResource(ref, opts);
}

/** @deprecated Use ensureDependencyResource */
export function ensureLayerResource(
  layerName: string,
  opts?: { versionConstraint?: string },
): Resource {
  const ref = stripTypePrefix(layerName);
  return ensureDependencyResource(ref, {
    ...(opts?.versionConstraint ? { versionConstraint: opts.versionConstraint } : {}),
  });
}

/** @deprecated Use listDependencies */
export function listAttachedPluginPins(layerId: string): PluginPinView[] {
  return listDependencies(layerId).map((dependency) => ({
    ref: dependency.ref,
    version_constraint: dependency.version_constraint,
    embed_on_export: dependency.embed_on_export,
    resource: dependency.resource,
  }));
}

export interface LayerPluginRow {
  layer_id: string;
  ref: string;
  version_constraint: string;
  order: number;
  embed_on_export: boolean;
}

/** @deprecated Use addDependency */
export function attachPluginPinToLayer(
  layerId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void {
  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  addDependency(layerId, ref, {
    ...(constraint ? { versionConstraint: constraint } : {}),
    ...(opts?.embedOnExport ? { embedOnExport: true } : {}),
  });
}

/** @deprecated Use removeDependency */
export function detachPluginPinFromLayer(layerId: string, ref: string): void {
  removeDependency(layerId, ref);
}

export function listLayerPlugins(layerId: string): LayerPluginRow[] {
  return listAttachedPluginPins(layerId).map((pin, index) => ({
    layer_id: layerId,
    ref: pin.ref,
    version_constraint: pin.version_constraint,
    order: index,
    embed_on_export: pin.embed_on_export,
  }));
}

/** @deprecated Use listDependencies */
export function listAttachedLayerRefs(layerId: string): LayerRefView[] {
  return listDependencies(layerId).map((dependency) => ({
    dependency_name: dependency.name,
    version_constraint: dependency.version_constraint,
    resource: dependency.resource,
  }));
}

export function attachCompositionResource(
  layerId: string,
  resource: Resource,
): void {
  markLayerDirty(layerId);
  addResourceToLayer(layerId, resource.id);
}

function normalizeCompositionType(type: string): ResourceType | undefined {
  if (type === "plugin" || type === "plugin_pin" || type === "layer") {
    return "plugin";
  }
  if ((RESOURCE_TYPES as readonly string[]).includes(type)) {
    return type as ResourceType;
  }
  return undefined;
}

export function resolveAttachmentType(
  selector: string,
  explicitType?: string,
  context?: { layerName?: string },
): ResourceType {
  const parsed = parseResourceSelector(selector);
  if (parsed.type) {
    const normalized = normalizeCompositionType(parsed.type);
    if (!normalized) {
      throw new Error(`Invalid --type: ${parsed.type}`);
    }
    return normalized;
  }
  if (explicitType) {
    const normalized = normalizeCompositionType(explicitType);
    if (!normalized) {
      throw new Error(`Invalid --type: ${explicitType}`);
    }
    return normalized;
  }
  throw new LayerAttachmentHintError(
    `Attachment type required for selector "${selector}"`,
    attachmentTypeRequiredHints(selector, context?.layerName),
  );
}

export class LayerAttachmentHintError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[]) {
    super(message);
    this.name = "LayerAttachmentHintError";
    this.hints = hints;
  }
}

export const LAYER_ATTACHMENT_TYPES = [
  ...MATERIAL_RESOURCE_TYPES,
  "plugin",
] as const;

export function attachmentTypeRequiredHints(
  selector: string,
  layerName?: string,
): string[] {
  const exampleLayer = layerName ?? "<layer>";
  return [
    `ht layer edit ${exampleLayer} --add ${selector} --type skill`,
    `Valid types: ${LAYER_ATTACHMENT_TYPES.join(", ")}`,
    "Or use a typed selector: skill:name, plugin:ref@marketplace",
  ];
}

export type LayerAttachmentType = (typeof LAYER_ATTACHMENT_TYPES)[number];

export function validateLayerAttachmentType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  if (type === "plugin" || type === "plugin_pin" || type === "layer") {
    return "plugin";
  }
  if (!(LAYER_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid --type. Valid: ${LAYER_ATTACHMENT_TYPES.join(", ")}`,
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

function normalizeAttachmentSelector(selector: string, explicitType?: string): string {
  if (selector.includes(":")) {
    return selector;
  }
  const type = explicitType;
  if (type === "plugin" || type === "plugin_pin" || type === "layer") {
    return `plugin:${selector}`;
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
  const explicitType = input.type;
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType, {
    layerName: input.layer.name,
  });
  markLayerDirty(input.layer.id);

  if (attachmentType === "plugin") {
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const ref = stripTypePrefix(selector);
    const resource = addDependency(input.layer.id, ref, {
      ...(input.version ? { versionConstraint: input.version } : {}),
      ...(input.embed ? { embedOnExport: true } : {}),
    });
    const displayRef = formatPluginRef(resource);
    if (input.version) {
      syncClaudeLayerPluginsAfterAdd(input.layer, displayRef, input.version);
    }
    if (input.sync) {
      await syncPluginResource(resource, { policy: "overwrite" });
    }
    const versionLabel = input.version ? ` (${input.version})` : "";
    return `Attached plugin ${displayRef}${versionLabel} to layer ${input.layer.name}`;
  }

  if (input.version) {
    throw new Error("--version is only supported for plugin attachments");
  }
  if (input.embed) {
    throw new Error("--embed is only supported for plugin attachments");
  }
  if (input.sync) {
    throw new Error("--sync is only supported for plugin attachments");
  }

  const resource = resolveTypedResource(selector, attachmentType);
  addResourceToLayer(input.layer.id, resource.id);
  return `Added ${resource.type} "${resource.name}" to layer ${input.layer.name}`;
}

export function removeLayerAttachment(input: RemoveLayerAttachmentInput): {
  message: string;
  removed: boolean;
} {
  const explicitType = input.type;
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType, {
    layerName: input.layer.name,
  });

  if (attachmentType === "plugin") {
    const ref = stripTypePrefix(selector);
    const pin = listAttachedPluginPins(input.layer.id).find(
      (entry) => entry.ref === ref || entry.resource.name === parseDependencyRef(ref).name,
    );
    if (!pin) {
      return {
        removed: false,
        message: `Plugin dependency "${ref}" not found on layer ${input.layer.name}`,
      };
    }
    removeDependency(input.layer.id, pin.ref);
    syncClaudeLayerPluginsAfterRemove(input.layer, pin.ref);
    return {
      removed: true,
      message: `Removed plugin ${pin.ref} from layer ${input.layer.name}`,
    };
  }

  const resource = resolveTypedResource(selector, attachmentType);
  markLayerDirty(input.layer.id);
  removeResourceFromLayer(input.layer.id, resource.id);
  return {
    removed: true,
    message: `Removed ${resource.type} "${resource.name}" from layer ${input.layer.name}`,
  };
}
