import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import {
  getPluginById,
  getPluginResources,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import { getEnvironmentResources } from "../models/environment.js";
import type { Resource } from "../types.js";
import { hookInventoryWireFromResource } from "../ui/hook-display.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { formatResourceTypeSummary } from "./project-status-payload.js";
import { collectProfilePluginIds } from "./profile-apply.js";
import { resolveExistingResourceFilesystemPath } from "./resource-editor-path.js";
import { harnessScopeWire, resourceHarnessScope } from "./harness-scope.js";

function optionalScopeWire(
  resource: Resource | undefined,
): { harness_scope: "all" | string[] } | Record<string, never> {
  if (!resource) return {};
  const scope = resourceHarnessScope(resource);
  return scope.kind === "all" ? {} : { harness_scope: harnessScopeWire(scope) };
}

export interface ProfileContentsResource {
  id: string;
  type: string;
  name: string;
  /** On-disk path or import origin label (hover target in desktop). */
  source: string;
  /** Canonical live file when `source` is a hub symlink or scan alias. */
  filesystem_path?: string | null;
  origin_kind?: string;
  origin_ref?: string;
  hook?: {
    event: string;
    script: string;
    matcher?: string;
    type?: string;
  };
  /** Present on not-staged rows: add is missing from the profile; update differs on disk. */
  not_staged_kind?: "add" | "update";
  /** `all` sentinel or a subset of harness slugs. Missing means All. */
  harness_scope?: "all" | string[];
}

export interface ProfileContentsPlugin {
  id: string;
  name: string;
  version: string;
  resources: ProfileContentsResource[];
  harness_scope?: "all" | string[];
  attachment_id?: string;
}

export interface ProfileContentsPin {
  ref: string;
  version_constraint: string;
  harness_scope?: "all" | string[];
  attachment_id?: string;
}

export interface ProfileContents {
  plugins: ProfileContentsPlugin[];
  stack_resource_count: number;
  stack_summary: string | null;
  /** Counts by resource type, plus `plugin` and `plugin_pin`. */
  type_counts: Record<string, number>;
  resources: ProfileContentsResource[];
  plugin_pins: ProfileContentsPin[];
  mcp_servers: string[];
}

function materialResources(resources: Resource[]): Resource[] {
  return resources.filter(
    (resource) => resource.type !== "plugin",
  );
}

export function toContentsResource(resource: Resource): ProfileContentsResource {
  const filesystemPath = resolveExistingResourceFilesystemPath(resource);
  const hook = hookInventoryWireFromResource(resource);
  const scope = resourceHarnessScope(resource);
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    source: resource.source,
    ...(resource.origin_kind ? { origin_kind: resource.origin_kind } : {}),
    ...(resource.origin_ref ? { origin_ref: resource.origin_ref } : {}),
    ...(filesystemPath ? { filesystem_path: filesystemPath } : {}),
    ...(hook ? { hook } : {}),
    ...(scope.kind === "all" ? {} : { harness_scope: harnessScopeWire(scope) }),
  };
}

export function toNotStagedContentsResource(
  resource: Resource,
  kind: "add" | "update",
): ProfileContentsResource {
  return {
    ...toContentsResource(resource),
    not_staged_kind: kind,
  };
}

function toContentsResources(resources: Resource[]): ProfileContentsResource[] {
  const order: string[] = [];
  const byKey = new Map<string, ProfileContentsResource>();
  for (const resource of materialResources(resources)) {
    const key = `${resource.type}:${resource.name}`;
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, toContentsResource(resource));
    }
  }
  return order
    .map((key) => byKey.get(key))
    .filter((entry): entry is ProfileContentsResource => entry !== undefined);
}

function resourcesForPlugin(pluginId: string): ProfileContentsResource[] {
  const plugin = getPluginById(pluginId);
  const attached = getPluginResources(pluginId);
  const fromEnv = plugin?.default_environment_id
    ? getEnvironmentResources(plugin.default_environment_id)
    : [];
  return toContentsResources([...attached, ...fromEnv]);
}

function buildTypeCounts(
  plugins: ProfileContentsPlugin[],
  resources: ProfileContentsResource[],
  pluginPins: ProfileContentsPin[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  if (plugins.length > 0) {
    counts.plugin = plugins.length;
  }
  for (const resource of resources) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }
  if (pluginPins.length > 0) {
    counts.plugin_pin = pluginPins.length;
  }
  return counts;
}

export function buildProfileContents(profileName: string): ProfileContents | null {
  if (isEmptyBuiltinProfile(profileName)) {
    return {
      plugins: [],
      stack_resource_count: 0,
      stack_summary: null,
      type_counts: {},
      resources: [],
      plugin_pins: [],
      mcp_servers: [],
    };
  }

  const plugin = resolvePluginSelector(profileName);
  if (!plugin || !isProfilePlugin(plugin)) {
    return null;
  }

  const pluginIds = collectProfilePluginIds(plugin);
  const merged = mergePluginsForApply(pluginIds);
  const resources = materialResources(merged.resources);
  const summary = formatResourceTypeSummary(resources);
  const rootAttached = getPluginResources(plugin.id);
  const plugins = merged.plugins.map((entry) => {
    const attachment = rootAttached.find(
      (resource) => resource.type === "plugin" && resource.name === entry.name,
    );
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      resources: resourcesForPlugin(entry.id),
      ...(attachment?.id ? { attachment_id: attachment.id } : {}),
      ...optionalScopeWire(attachment),
    };
  });
  const pluginPins = merged.pluginPins.map((pin) => {
    const attachment = rootAttached.find(
      (resource) => resource.name === pin.ref || resource.origin_ref === pin.ref,
    );
    return {
      ref: pin.ref,
      version_constraint: pin.version_constraint,
      ...(attachment?.id ? { attachment_id: attachment.id } : {}),
      ...optionalScopeWire(attachment),
    };
  });
  const contentsResources = resources.map(toContentsResource);

  return {
    plugins,
    stack_resource_count: resources.length,
    stack_summary: summary.length > 0 ? summary : null,
    type_counts: buildTypeCounts(plugins, contentsResources, pluginPins),
    resources: contentsResources,
    plugin_pins: pluginPins,
    mcp_servers: resources
      .filter((resource) => resource.type === "mcp_server")
      .map((resource) => resource.name),
  };
}
