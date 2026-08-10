import { getEnvironment } from "../../models/environment.js";
import { getPluginById, getPluginResources, resolveApName } from "../../models/plugin-model.js";
import { listDependencies } from "../plugin-dependency.js";
import { getPluginOverrides } from "../plugin-overrides.js";
import { AP_SCHEMA_URL } from "./validate.js";
import type { DependencySourceKind, PluginOverrides } from "../../types.js";

export const HT_EXTENSION_NAMESPACE = "com.harnesstap";
export const HT_EXTENSION_SCHEMA = "urn:harnesstap:ap-extension:v1";

export interface ApDependency {
  name: string;
  constraint: string;
  source: DependencySourceKind;
}

export interface HarnesstapExtension {
  schema: typeof HT_EXTENSION_SCHEMA;
  /** The unslugged local plugin name, so import can restore it. */
  sourceName: string;
  profile: boolean;
  dependencies: ApDependency[];
  overrides: PluginOverrides;
  needs: string[];
  /** Environment *name*, never its local id — ids are not portable. */
  defaultEnvironment?: string;
  /** Relative paths into `com.harnesstap/`, omitted for absent types. */
  components: Record<string, string>;
}

export interface ApManifest {
  $schema: string;
  name: string;
  version: string;
  description?: string;
  author?: string | Record<string, unknown>;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, HarnesstapExtension | Record<string, unknown>>;
}

/** One row per non-AP resource type: where it lives and its manifest key. */
export const COMPONENT_LAYOUT: Record<string, { path: string; key: string }> = {
  instruction: { path: `${HT_EXTENSION_NAMESPACE}/instructions`, key: "instructions" },
  rule: { path: `${HT_EXTENSION_NAMESPACE}/rules`, key: "rules" },
  agent: { path: `${HT_EXTENSION_NAMESPACE}/agents`, key: "agents" },
  command: { path: `${HT_EXTENSION_NAMESPACE}/commands`, key: "commands" },
  hook: { path: `${HT_EXTENSION_NAMESPACE}/hooks.toml`, key: "hooks" },
  permission: { path: `${HT_EXTENSION_NAMESPACE}/permissions.toml`, key: "permissions" },
  env_var: { path: `${HT_EXTENSION_NAMESPACE}/env.toml`, key: "envVars" },
  model_config: { path: `${HT_EXTENSION_NAMESPACE}/model.toml`, key: "modelConfig" },
};

export function buildApManifest(pluginId: string): ApManifest {
  const plugin = getPluginById(pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

  const present = new Set(getPluginResources(pluginId).map((resource) => resource.type));
  const components: Record<string, string> = {};
  for (const [type, layout] of Object.entries(COMPONENT_LAYOUT)) {
    if (present.has(type as never)) components[layout.key] = layout.path;
  }

  const defaultEnvironment = plugin.default_environment_id
    ? getEnvironment(plugin.default_environment_id)?.name
    : undefined;

  const extension: HarnesstapExtension = {
    schema: HT_EXTENSION_SCHEMA,
    sourceName: plugin.name,
    profile: plugin.tags.includes("profile"),
    dependencies: listDependencies(pluginId).map((dependency) => ({
      name: dependency.name,
      constraint: dependency.version_constraint || "*",
      source: dependency.source_kind,
    })),
    overrides: getPluginOverrides(pluginId),
    needs: plugin.needs ?? [],
    ...(defaultEnvironment ? { defaultEnvironment } : {}),
    components,
  };

  return {
    $schema: AP_SCHEMA_URL,
    name: resolveApName(plugin),
    version: plugin.version,
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.tags.length > 0 ? { keywords: plugin.tags } : {}),
    extensions: { [HT_EXTENSION_NAMESPACE]: extension },
  };
}
