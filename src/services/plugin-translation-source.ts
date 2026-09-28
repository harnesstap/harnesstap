import { parsePluginRef } from "../plugins/host-plugin-manifest.js";
import type { PluginDependencyMetadata, ResourceCreateInput } from "../types.js";
import { isHostPluginPinResource } from "./host-plugin-serialize.js";

export const PLUGIN_TRANSLATION_SCHEMA = "urn:harnesstap:plugin-translation:v1" as const;

export interface PluginTranslationSource {
  plugin: string;
  marketplace: string;
  origin_ref: string;
  version?: string;
}

export interface PluginTranslationMarkerEntry extends PluginTranslationSource {
  type: string;
  name: string;
}

export interface PluginTranslationMarkerFile {
  schema: typeof PLUGIN_TRANSLATION_SCHEMA;
  entries: PluginTranslationMarkerEntry[];
}

export function pluginTranslationSourceFromPin(
  pin: ResourceCreateInput,
): PluginTranslationSource | undefined {
  if (
    !isHostPluginPinResource({
      type: pin.type,
      metadata: pin.metadata,
      origin_ref: pin.origin_ref ?? "",
    })
  ) {
    return undefined;
  }
  const metadata = (pin.metadata ?? {}) as PluginDependencyMetadata;
  const originRef = pin.origin_ref?.trim() || pin.name;
  const parsed = parsePluginRef(
    originRef.includes("@")
      ? originRef
      : `${pin.name}@${metadata.marketplace_name ?? "local"}`,
  );
  const marketplace =
    parsed.marketplace || metadata.marketplace_name?.trim() || "local";
  const pluginName = parsed.name || pin.name;
  const resolvedOrigin = originRef.includes("@")
    ? originRef
    : `${pluginName}@${marketplace}`;
  const version = metadata.resolved_version?.trim();
  return {
    plugin: pluginName,
    marketplace,
    origin_ref: resolvedOrigin,
    ...(version ? { version } : {}),
  };
}
