import { listPluginExcludes, portableUpstream } from "../plugin-extends.js";
import { getEnvironment } from "../../models/environment.js";
import { getPluginById, getPluginResources, resolveApName } from "../../models/plugin-model.js";
import type { DependencySourceKind, PluginOverrides, PluginUpstream } from "../../types.js";
import { resourceHarnessScope } from "../harness-scope.js";
import { listDependencies } from "../plugin-dependency.js";
import { getPluginOverrides } from "../plugin-overrides.js";
import { AP_SCHEMA_URL } from "./validate.js";

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
  /** Environment *name*, never its local id: ids are not portable. */
  defaultEnvironment?: string;
  /** Relative paths into `com.harnesstap/`, omitted for absent types. */
  components: Record<string, string>;
  /** `type:name` → harness slugs. Omitted keys and missing field mean All. */
  harnessScopes?: Record<string, string[]>;
  /**
   * Agent Skills directory name to the original library resource name, when
   * export had to rename a skill so the directory matches the Agent Skills rules.
   */
  skillNames?: Record<string, string>;
  /**
   * Upstream link, snake_case as agreed with HarnessTap Cloud:
   * `{ kind: "extends" | "fork", ref: "org/catalog/slug@range", version_at_link }`.
   * Only written for a catalog ref.
   */
  upstream?: PluginUpstream;
  /**
   * Parent items an extends child hides: `<type>:<name>` or `plugin:<name>`.
   * Root manifest only, and only with `upstream.kind = "extends"`.
   */
  exclude?: string[];
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

export function buildApManifest(pluginId: string, options?: { nested?: boolean }): ApManifest {
  const plugin = getPluginById(pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

  const attached = getPluginResources(pluginId);
  const present = new Set(attached.map((resource) => resource.type));
  const components: Record<string, string> = {};
  for (const [type, layout] of Object.entries(COMPONENT_LAYOUT)) {
    if (present.has(type as never)) components[layout.key] = layout.path;
  }
  const harnessScopes: Record<string, string[]> = {};
  for (const resource of attached) {
    const scope = resourceHarnessScope(resource);
    if (scope.kind === "subset") {
      harnessScopes[`${resource.type}:${resource.name}`] = [...scope.harnesses];
    }
  }

  const defaultEnvironment = plugin.default_environment_id
    ? getEnvironment(plugin.default_environment_id)?.name
    : undefined;

  const exportedUpstream = portableUpstream(plugin);
  const exclude =
    exportedUpstream?.kind === "extends" && !options?.nested ? listPluginExcludes(pluginId) : [];
  const extension: HarnesstapExtension = {
    schema: HT_EXTENSION_SCHEMA,
    sourceName: plugin.name,
    profile: plugin.tags.includes("profile"),
    // The full ref (`name@marketplace`, a git URL, `org/catalog/slug`) is
    // what import reads back; the bare name would lose the source.
    dependencies: listDependencies(pluginId).map((dependency) => ({
      name: dependency.ref,
      constraint: dependency.version_constraint || "*",
      source: dependency.source_kind,
    })),
    overrides: getPluginOverrides(pluginId),
    needs: plugin.needs ?? [],
    ...(defaultEnvironment ? { defaultEnvironment } : {}),
    components,
    ...(Object.keys(harnessScopes).length > 0 ? { harnessScopes } : {}),
    ...(exportedUpstream ? { upstream: exportedUpstream } : {}),
    ...(exclude.length > 0 ? { exclude } : {}),
  };

  return {
    $schema: AP_SCHEMA_URL,
    name: resolveApName(plugin),
    version: plugin.version,
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.author ? { author: plugin.author } : {}),
    ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
    ...(plugin.repository ? { repository: plugin.repository } : {}),
    ...(plugin.license ? { license: plugin.license } : {}),
    ...(plugin.tags.length > 0 ? { keywords: plugin.tags } : {}),
    extensions: { [HT_EXTENSION_NAMESPACE]: extension },
  };
}
