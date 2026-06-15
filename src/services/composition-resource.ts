import { ulid } from "ulid";
import { getDb } from "../db/connection.js";
import { getPluginResources, addResourceToPlugin } from "../models/plugin-component.js";
import {
  findResourceByKey,
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import { parseResourceSelector } from "./resource-selector.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import {
  LayerAttachmentHintError,
  attachmentTypeRequiredHints,
} from "./layer-attachments.js";
import type {
  LayerResourceMetadata,
  PluginResourceMetadata,
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
): PluginResourceMetadata {
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
  const type = parsed.type ?? "plugin";
  if (type !== "plugin") {
    throw new Error(`Expected plugin selector, got type: ${type}`);
  }

  const ref = parsed.namespace ? `${parsed.name}@${parsed.namespace}` : parsed.name;
  const identity = parsePluginRef(ref);
  const namespace = pluginResourceNamespace(identity, opts?.versionConstraint);
  const existing = findResourceByKey("plugin", identity.name, namespace);
  if (existing) {
    if (opts?.versionConstraint) {
      const metadata = {
        ...(existing.metadata as PluginResourceMetadata),
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
      type: "plugin",
      name: identity.name,
      namespace,
      description: `Plugin reference: ${ref}`,
      content: "{}",
      metadata,
      source: "composition:plugin",
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
  return getPluginResources(pluginId)
    .filter((resource) => resource.type === "plugin")
    .map((resource) => {
      const metadata = resource.metadata as PluginResourceMetadata;
      const ref = formatPluginRef(resource);
      return {
        ref,
        version_constraint: metadata.version_constraint ?? "",
        embed_on_export: metadata.portable === "embed",
        resource,
      };
    });
}

export function listAttachedLayerRefs(pluginId: string): LayerRefView[] {
  return getPluginResources(pluginId)
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
  addResourceToPlugin(pluginId, resource.id);
}

export function resolveAttachmentType(
  selector: string,
  explicitType?: string,
  context?: { layerName?: string },
): ResourceType {
  const parsed = parseResourceSelector(selector);
  const normalizedExplicit =
    explicitType === "layer-dependency" ? "layer" : explicitType;
  if (parsed.type) {
    if ((parsed.type as string) === "layer-dependency") {
      return "layer";
    }
    if (!(RESOURCE_TYPES as readonly string[]).includes(parsed.type)) {
      throw new Error(`Invalid --type: ${parsed.type}`);
    }
    return parsed.type;
  }
  if (normalizedExplicit) {
    if (!(RESOURCE_TYPES as readonly string[]).includes(normalizedExplicit)) {
      throw new Error(`Invalid --type: ${explicitType}`);
    }
    return normalizedExplicit as ResourceType;
  }
  throw new LayerAttachmentHintError(
    `Attachment type required for selector "${selector}"`,
    attachmentTypeRequiredHints(selector, context?.layerName),
  );
}

export function migrationUpsertPluginResource(input: {
  ref: string;
  version_constraint: string;
  embed_on_export: boolean;
}): Resource {
  const portable = input.embed_on_export ? "embed" : "reference";
  const constraint =
    input.version_constraint === "latest" || input.version_constraint === "*"
      ? undefined
      : input.version_constraint;
  return ensurePluginResource(`plugin:${input.ref}`, {
    versionConstraint: constraint,
    portable,
  });
}

export function migrationUpsertLayerResource(input: {
  dependency_name: string;
  version_constraint: string;
}): Resource {
  const constraint =
    input.version_constraint === "latest" || input.version_constraint === "*"
      ? undefined
      : input.version_constraint;
  return ensureLayerResource(`layer:${input.dependency_name}`, {
    versionConstraint: constraint,
  });
}

export function createMigrationResourceId(): string {
  return ulid();
}
