import {
  addResourceToPreset,
  removeResourceFromPreset,
  syncClaudePresetPluginsAfterAdd,
  syncClaudePresetPluginsAfterRemove,
  addDependencyToPreset,
  removeDependencyFromPreset,
} from "../models/preset.js";
import { addPluginToPreset, removePluginFromPreset } from "../models/plugin.js";
import { resolveResource } from "../models/resource.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import type { Preset, ResourceType } from "../types.js";
import { RESOURCE_TYPES } from "../types.js";

export const PRESET_ATTACHMENT_TYPES = [
  ...RESOURCE_TYPES,
  "plugin",
  "preset-dependency",
] as const;

export type PresetAttachmentType = (typeof PRESET_ATTACHMENT_TYPES)[number];

interface AddPresetAttachmentInput {
  preset: Preset;
  selector: string;
  type?: string;
  version?: string;
  embed?: boolean;
}

interface RemovePresetAttachmentInput {
  preset: Preset;
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
  return `--type is required (one of: ${PRESET_ATTACHMENT_TYPES.join(", ")})`;
}

function parseAttachmentType(type: string | undefined): PresetAttachmentType {
  if (!type) {
    throw new Error(formatTypeRequirement());
  }

  if (!PRESET_ATTACHMENT_TYPES.includes(type as PresetAttachmentType)) {
    throw new Error(`Invalid --type. Valid: ${PRESET_ATTACHMENT_TYPES.join(", ")}`);
  }

  return type as PresetAttachmentType;
}

function assertNoVersion(_type: ResourceType, version: string | undefined): void {
  if (version) {
    throw new Error("--version is only supported for --type plugin and --type preset-dependency");
  }
}

function assertNoEmbed(_type: PresetAttachmentType, embed: boolean | undefined): void {
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

export function addPresetAttachment(input: AddPresetAttachmentInput): string {
  const type = parseAttachmentType(input.type);

  if (RESOURCE_TYPES.includes(type as ResourceType)) {
    assertNoVersion(type as ResourceType, input.version);
    assertNoEmbed(type, input.embed);
    const resource = resolveTypedResource(input.selector, type as ResourceType);
    addResourceToPreset(input.preset.id, resource.id);
    return `Added ${resource.type} "${resource.name}" to preset ${input.preset.name}`;
  }

  if (type === "plugin") {
    if (!input.version) {
      throw new Error("--version is required for --type plugin");
    }
    parseVersionConstraint(input.version);
    addPluginToPreset(input.preset.id, input.selector, input.version, {
      embedOnExport: Boolean(input.embed),
    });
    syncClaudePresetPluginsAfterAdd(input.preset, input.selector, input.version);
    return `Pinned ${input.selector} (${input.version}) on preset ${input.preset.name}`;
  }

  if (!input.version) {
    throw new Error("--version is required for --type preset-dependency");
  }
  assertNoEmbed(type, input.embed);
  parseVersionConstraint(input.version);
  addDependencyToPreset(input.preset.id, input.selector, input.version);
  return `Added dependency ${input.selector} (${input.version}) to preset ${input.preset.name}@${input.preset.version}`;
}

export function removePresetAttachment(input: RemovePresetAttachmentInput): {
  message: string;
  removed: boolean;
} {
  const type = parseAttachmentType(input.type);

  if (RESOURCE_TYPES.includes(type as ResourceType)) {
    const resource = resolveTypedResource(input.selector, type as ResourceType);
    removeResourceFromPreset(input.preset.id, resource.id);
    return {
      removed: true,
      message: `Removed ${resource.type} "${resource.name}" from preset ${input.preset.name}`,
    };
  }

  if (type === "plugin") {
    removePluginFromPreset(input.preset.id, input.selector);
    syncClaudePresetPluginsAfterRemove(input.preset, input.selector);
    return {
      removed: true,
      message: `Removed plugin pin ${input.selector} from preset ${input.preset.name}`,
    };
  }

  const removed = removeDependencyFromPreset(input.preset.id, input.selector);
  return {
    removed,
    message: removed
      ? `Removed dependency ${input.selector} from preset ${input.preset.name}@${input.preset.version}`
      : `Dependency "${input.selector}" not found on preset ${input.preset.name}@${input.preset.version}`,
  };
}
