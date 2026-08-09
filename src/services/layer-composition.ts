import { getDb } from "../db/connection.js";
import {
  addResourceToLayer,
  getLayerResources,
  removeResourceFromLayer,
  syncClaudeLayerPluginsAfterAdd,
  syncClaudeLayerPluginsAfterRemove,
} from "../models/layer-model.js";
import {
  findResourceByKey,
  normalizeResourceInput,
  resolveResource,
  upsertResource,
} from "../models/resource.js";
import { markLayerDirty } from "./layer-versioning.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import { parseResourceSelector } from "./resource-selector.js";
import { syncPluginResource } from "./resource-sync.js";
import type {
  Layer,
  LayerResourceMetadata,
  PluginPinMetadata,
  Resource,
  ResourceType,
} from "../types.js";
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
    "plugin_pin",
    identity.name,
    pluginResourceNamespace(identity, versionConstraint),
  );
  if (withConstraint) {
    return withConstraint;
  }
  if (!versionConstraint) {
    return findResourceByKey("plugin_pin", identity.name, identity.namespace);
  }
  return undefined;
}

export function parsePluginRef(ref: string): {
  name: string;
  namespace: string;
  origin_ref: string;
} {
  const trimmed = ref.trim();
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const name = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    return { name, namespace: "", origin_ref: trimmed };
  }

  const at = trimmed.lastIndexOf("@");
  if (at === -1) {
    return { name: trimmed, namespace: "", origin_ref: trimmed };
  }

  const name = trimmed.slice(0, at);
  const namespace = trimmed.slice(at + 1);
  return { name, namespace, origin_ref: trimmed };
}

function pluginMetadataFromRef(
  ref: string,
  opts?: {
    versionConstraint?: string;
    portable?: "reference" | "embed";
  },
): PluginPinMetadata {
  const parsed = parsePluginRef(ref);
  const isLocal = parsed.namespace === "" && parsed.origin_ref.startsWith(".");
  return {
    source_kind: isLocal ? "local" : "marketplace",
    marketplace_name: parsed.namespace || undefined,
    version_constraint: opts?.versionConstraint,
    sync_status: "never_synced",
    portable: opts?.portable ?? "reference",
  };
}

export function ensurePluginResource(
  selector: string,
  opts?: {
    versionConstraint?: string;
    portable?: "reference" | "embed";
  },
): Resource {
  const parsed = parseResourceSelector(selector);
  const type = parsed.type ?? "plugin_pin";
  if (type !== "plugin_pin") {
    throw new Error(`Expected plugin_pin selector, got type: ${type}`);
  }

  const ref = parsed.namespace ? `${parsed.name}@${parsed.namespace}` : parsed.name;
  const identity = parsePluginRef(ref);
  const namespace = pluginResourceNamespace(identity, opts?.versionConstraint);
  const existing = findResourceByKey("plugin_pin", identity.name, namespace);
  if (existing) {
    if (opts?.versionConstraint) {
      const metadata = {
        ...(existing.metadata as PluginPinMetadata),
        version_constraint: opts.versionConstraint,
      };
      if (opts.portable) {
        metadata.portable = opts.portable;
      }
      const db = getDb();
      db.prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?").run(
        JSON.stringify(metadata),
        new Date().toISOString(),
        existing.id,
      );
      return { ...existing, metadata };
    }
    return existing;
  }

  const metadata = pluginMetadataFromRef(ref, opts);

  const result = upsertResource(
    normalizeResourceInput({
      type: "plugin_pin",
      name: identity.name,
      namespace,
      description: `Plugin pin: ${ref}`,
      content: "{}",
      metadata,
      source: "composition:plugin_pin",
      origin_kind: identity.namespace ? "marketplace_link" : "manual",
      origin_ref: identity.origin_ref,
    }),
    { policy: "overwrite" },
  );

  if (result.action === "skipped") {
    throw new Error(`Failed to create plugin resource: ${ref}`);
  }
  return result.resource;
}

export function ensureLayerResource(
  layerName: string,
  opts?: { versionConstraint?: string },
): Resource {
  const parsed = parseResourceSelector(layerName);
  const name = parsed.type === "layer" ? parsed.name : layerName.split("@")[0] ?? layerName;
  if (!name) {
    throw new Error(`Invalid layer selector: ${layerName}`);
  }

  const versionConstraint =
    opts?.versionConstraint ??
    (parsed.namespace && parsed.type === "layer" ? parsed.namespace : undefined);
  const namespace = versionConstraint ?? "";

  if (versionConstraint) {
    parseVersionConstraint(versionConstraint);
  }

  const existing = findResourceByKey("layer", name, namespace);
  if (existing) {
    return existing;
  }

  const metadata: LayerResourceMetadata = {};
  if (versionConstraint) {
    metadata.version_constraint = versionConstraint;
  }

  const result = upsertResource(
    normalizeResourceInput({
      type: "layer",
      name,
      namespace,
      description: `Layer reference: ${name}${versionConstraint ? `@${versionConstraint}` : ""}`,
      content: "{}",
      metadata,
      source: "composition:layer",
      origin_kind: "manual",
      origin_ref: name,
    }),
    { policy: "overwrite" },
  );

  if (result.action === "skipped") {
    throw new Error(`Failed to create layer resource: ${name}`);
  }
  return result.resource;
}

export function listAttachedPluginPins(pluginId: string): PluginPinView[] {
  return getLayerResources(pluginId)
    .filter((resource) => resource.type === "plugin_pin")
    .map((resource) => {
      const metadata = resource.metadata as PluginPinMetadata;
      const ref = formatPluginRef(resource);
      return {
        ref,
        version_constraint: metadata.version_constraint ?? "",
        embed_on_export: metadata.portable === "embed",
        resource,
      };
    });
}

export interface LayerPluginRow {
  layer_id: string;
  ref: string;
  version_constraint: string;
  order: number;
  embed_on_export: boolean;
}

export function attachPluginPinToLayer(
  layerId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void {
  const selector = ref.includes(":") ? ref : `plugin_pin:${ref}`;
  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  const resource = ensurePluginResource(selector, {
    versionConstraint: constraint,
    portable: opts?.embedOnExport ? "embed" : "reference",
  });
  addResourceToLayer(layerId, resource.id);
}

export function detachPluginPinFromLayer(layerId: string, ref: string): void {
  const pin = listAttachedPluginPins(layerId).find((entry) => entry.ref === ref);
  if (!pin) return;
  removeResourceFromLayer(layerId, pin.resource.id);
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

export function listAttachedLayerRefs(pluginId: string): LayerRefView[] {
  return getLayerResources(pluginId)
    .filter((resource) => resource.type === "layer")
    .map((resource) => {
      const metadata = resource.metadata as LayerResourceMetadata;
      return {
        dependency_name: resource.name,
        version_constraint:
          metadata.version_constraint ?? resource.namespace ?? "",
        resource,
      };
    });
}

export function attachCompositionResource(
  pluginId: string,
  resource: Resource,
): void {
  addResourceToLayer(pluginId, resource.id);
}

export function resolveAttachmentType(
  selector: string,
  explicitType?: string,
  context?: { layerName?: string },
): ResourceType {
  const parsed = parseResourceSelector(selector);
  if (parsed.type) {
    if (!(RESOURCE_TYPES as readonly string[]).includes(parsed.type)) {
      throw new Error(`Invalid --type: ${parsed.type}`);
    }
    return parsed.type;
  }
  if (explicitType) {
    if (!(RESOURCE_TYPES as readonly string[]).includes(explicitType)) {
      throw new Error(`Invalid --type: ${explicitType}`);
    }
    return explicitType as ResourceType;
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
  "plugin_pin",
  "layer",
] as const;

export function attachmentTypeRequiredHints(
  selector: string,
  layerName?: string,
): string[] {
  const exampleLayer = layerName ?? "<layer>";
  return [
    `ht layer edit ${exampleLayer} --add ${selector} --type skill`,
    `Valid types: ${LAYER_ATTACHMENT_TYPES.join(", ")}`,
    "Or use a typed selector: skill:name, plugin_pin:ref@marketplace, layer:dep",
  ];
}

export type LayerAttachmentType = (typeof LAYER_ATTACHMENT_TYPES)[number];

export function validateLayerAttachmentType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
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
  if (type === "plugin_pin") {
    return `plugin_pin:${selector}`;
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
  const explicitType = input.type;
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType, {
    layerName: input.layer.name,
  });

  if (attachmentType === "plugin_pin") {
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const resource = ensurePluginResource(selector, {
      versionConstraint: input.version,
      portable: input.embed ? "embed" : undefined,
    });
    addResourceToLayer(input.layer.id, resource.id);
    const ref = formatPluginRef(resource);
    if (input.version) {
      syncClaudeLayerPluginsAfterAdd(input.layer, ref, input.version);
    }
    if (input.sync) {
      await syncPluginResource(resource, { policy: "overwrite" });
    }
    const versionLabel = input.version ? ` (${input.version})` : "";
    markLayerDirty(input.layer.id);
    return `Attached plugin pin ${ref}${versionLabel} to layer ${input.layer.name}`;
  }

  if (attachmentType === "layer") {
    if (input.embed) {
      throw new Error("--embed is only supported for plugin_pin attachments");
    }
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const resource = ensureLayerResource(selector, {
      versionConstraint: input.version,
    });
    addResourceToLayer(input.layer.id, resource.id);
    const versionLabel = input.version ? ` (${input.version})` : "";
    markLayerDirty(input.layer.id);
    return `Attached layer ${resource.name}${versionLabel} to layer ${input.layer.name}`;
  }

  if (input.version) {
    throw new Error("--version is only supported for plugin_pin and layer attachments");
  }
  if (input.embed) {
    throw new Error("--embed is only supported for plugin_pin attachments");
  }
  if (input.sync) {
    throw new Error("--sync is only supported for plugin_pin attachments");
  }

  const resource = resolveTypedResource(selector, attachmentType);
  addResourceToLayer(input.layer.id, resource.id);
  markLayerDirty(input.layer.id);
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

  if (attachmentType === "plugin_pin") {
    const parsed = parseResourceSelector(selector);
    const ref = parsed.namespace ? `${parsed.name}@${parsed.namespace}` : parsed.name;
    const pin = listAttachedPluginPins(input.layer.id).find((entry) => entry.ref === ref);
    if (!pin) {
      throw new Error(`Plugin pin not found: ${ref}`);
    }
    removeResourceFromLayer(input.layer.id, pin.resource.id);
    syncClaudeLayerPluginsAfterRemove(input.layer, pin.ref);
    markLayerDirty(input.layer.id);
    return {
      removed: true,
      message: `Removed plugin pin ${pin.ref} from layer ${input.layer.name}`,
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
    removeResourceFromLayer(input.layer.id, resourceResult.resource.id);
    markLayerDirty(input.layer.id);
    return {
      removed: true,
      message: `Removed layer ${resourceResult.resource.name} from layer ${input.layer.name}`,
    };
  }

  const resource = resolveTypedResource(selector, attachmentType);
  removeResourceFromLayer(input.layer.id, resource.id);
  markLayerDirty(input.layer.id);
  return {
    removed: true,
    message: `Removed ${resource.type} "${resource.name}" from layer ${input.layer.name}`,
  };
}
