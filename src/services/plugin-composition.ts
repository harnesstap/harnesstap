import {
  addResourceToPlugin,
  removeResourceFromPlugin,
  syncClaudeMarketplacePluginsAfterAdd,
  syncClaudeMarketplacePluginsAfterRemove,
} from "../models/plugin-model.js";
import { findResourceByKey, resolveResource } from "../models/resource.js";
import { markPluginDirty } from "./plugin-versioning.js";
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
import type { Plugin, Resource, ResourceType } from "../types.js";
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

export interface PluginRefView {
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

/** @deprecated Use listDependencies */
export function listAttachedPluginPins(pluginId: string): PluginPinView[] {
  return listDependencies(pluginId).map((dependency) => ({
    ref: dependency.ref,
    version_constraint: dependency.version_constraint,
    embed_on_export: dependency.embed_on_export,
    resource: dependency.resource,
  }));
}

/** @deprecated Use addDependency */
export function attachPluginPinToPlugin(
  pluginId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void {
  const constraint =
    versionConstraint === "latest" || versionConstraint === "*"
      ? undefined
      : versionConstraint;
  addDependency(pluginId, ref, {
    ...(constraint ? { versionConstraint: constraint } : {}),
    ...(opts?.embedOnExport ? { embedOnExport: true } : {}),
  });
}

/** @deprecated Use removeDependency */
export function detachPluginPinFromPlugin(pluginId: string, ref: string): void {
  removeDependency(pluginId, ref);
}

/** @deprecated Use listDependencies */
export function listAttachedPluginRefs(pluginId: string): PluginRefView[] {
  return listDependencies(pluginId).map((dependency) => ({
    dependency_name: dependency.ref,
    version_constraint: dependency.version_constraint,
    resource: dependency.resource,
  }));
}

export function attachCompositionResource(
  pluginId: string,
  resource: Resource,
): void {
  markPluginDirty(pluginId);
  addResourceToPlugin(pluginId, resource.id);
}

function normalizeCompositionType(type: string): ResourceType | undefined {
  if (type === "plugin" || type === "plugin_pin") {
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
  context?: { pluginName?: string },
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
  throw new PluginAttachmentHintError(
    `Attachment type required for selector "${selector}"`,
    attachmentTypeRequiredHints(selector, context?.pluginName),
  );
}

export class PluginAttachmentHintError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[]) {
    super(message);
    this.name = "PluginAttachmentHintError";
    this.hints = hints;
  }
}

export const PLUGIN_ATTACHMENT_TYPES = [
  ...MATERIAL_RESOURCE_TYPES,
  "plugin",
] as const;

export function attachmentTypeRequiredHints(
  selector: string,
  pluginName?: string,
): string[] {
  const examplePlugin = pluginName ?? "<plugin>";
  return [
    `ht plugin edit ${examplePlugin} --add ${selector} --type skill`,
    `Valid types: ${PLUGIN_ATTACHMENT_TYPES.join(", ")}`,
    "Or use a typed selector: skill:name, plugin:ref@marketplace",
  ];
}

export type PluginAttachmentType = (typeof PLUGIN_ATTACHMENT_TYPES)[number];

export function validatePluginAttachmentType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  if (type === "plugin" || type === "plugin_pin") {
    return "plugin";
  }
  if (!(PLUGIN_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid --type. Valid: ${PLUGIN_ATTACHMENT_TYPES.join(", ")}`,
    );
  }
  return type;
}

interface AddPluginAttachmentInput {
  plugin: Plugin;
  selector: string;
  type?: string;
  version?: string;
  embed?: boolean;
  sync?: boolean;
}

interface RemovePluginAttachmentInput {
  plugin: Plugin;
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
  if (type === "plugin" || type === "plugin_pin") {
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

export async function addPluginAttachment(input: AddPluginAttachmentInput): Promise<string> {
  const explicitType = input.type;
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType, {
    pluginName: input.plugin.name,
  });
  markPluginDirty(input.plugin.id);

  if (attachmentType === "plugin") {
    if (input.version) {
      parseVersionConstraint(input.version);
    }
    const ref = stripTypePrefix(selector);
    const resource = addDependency(input.plugin.id, ref, {
      ...(input.version ? { versionConstraint: input.version } : {}),
      ...(input.embed ? { embedOnExport: true } : {}),
    });
    const displayRef = formatPluginRef(resource);
    if (input.version) {
      syncClaudeMarketplacePluginsAfterAdd(input.plugin, displayRef, input.version);
    }
    if (input.sync) {
      await syncPluginResource(resource, { policy: "overwrite" });
    }
    const versionLabel = input.version ? ` (${input.version})` : "";
    return `Attached plugin ${displayRef}${versionLabel} to plugin ${input.plugin.name}`;
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
  addResourceToPlugin(input.plugin.id, resource.id);
  return `Added ${resource.type} "${resource.name}" to plugin ${input.plugin.name}`;
}

export function removePluginAttachment(input: RemovePluginAttachmentInput): {
  message: string;
  removed: boolean;
} {
  const explicitType = input.type;
  const selector = normalizeAttachmentSelector(input.selector, explicitType);
  const attachmentType = resolveAttachmentType(selector, explicitType, {
    pluginName: input.plugin.name,
  });

  if (attachmentType === "plugin") {
    const ref = stripTypePrefix(selector);
    const pin = listAttachedPluginPins(input.plugin.id).find(
      (entry) => entry.ref === ref || entry.resource.name === parseDependencyRef(ref).name,
    );
    if (!pin) {
      return {
        removed: false,
        message: `Plugin dependency "${ref}" not found on plugin ${input.plugin.name}`,
      };
    }
    removeDependency(input.plugin.id, pin.ref);
    syncClaudeMarketplacePluginsAfterRemove(input.plugin, pin.ref);
    return {
      removed: true,
      message: `Removed plugin ${pin.ref} from plugin ${input.plugin.name}`,
    };
  }

  const resource = resolveTypedResource(selector, attachmentType);
  markPluginDirty(input.plugin.id);
  removeResourceFromPlugin(input.plugin.id, resource.id);
  return {
    removed: true,
    message: `Removed ${resource.type} "${resource.name}" from plugin ${input.plugin.name}`,
  };
}
