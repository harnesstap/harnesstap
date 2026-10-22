import { parseUpstream, setPluginUpstream } from "../plugin-upstream.js";
import { assertNoExtendsCycle, parseExcludeList, writePluginExcludes } from "../plugin-extends.js";
import matter from "gray-matter";
import { getEnvironmentByName } from "../../models/environment.js";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginResourceHarnessScope,
  setPluginSpecMetadata,
  setPluginTags,
} from "../../models/plugin-model.js";
import { createResource } from "../../models/resource.js";
import type {
  ClaudePluginConfig,
  DependencySourceKind,
  Plugin,
  PluginOrigin,
  PluginOverrides,
  PluginUpstream,
  ResourceCreateInput,
  ResourceType,
} from "../../types.js";
import { DEPENDENCY_SOURCE_KINDS } from "../../types.js";
import { parseHarnessScope } from "../harness-scope.js";
import { parseHooksJsonContent } from "../hook-serialization.js";
import { addDependency } from "../plugin-dependency.js";
import {
  setPluginResourceOverride,
  setPluginVersionOverride,
} from "../plugin-overrides.js";
import { parseTransportToml } from "../toml/read.js";
import type { ApPackageFiles } from "./files.js";
import { installAgentPluginPackage } from "./install-root.js";
import type { ApDependency, HarnesstapExtension } from "./manifest.js";
import { COMPONENT_LAYOUT, HT_EXTENSION_NAMESPACE } from "./manifest.js";
import { collectOpaquePackage, replaceOpaqueFiles } from "./opaque.js";
import { type ApLoadReport, loadSpecPackage, readContainedPackageFiles } from "./spec-load.js";

const RESOURCE_SOURCE = "ap-package";

export interface ParsedApPackage {
  /** AP package name from the manifest. */
  name: string;
  /** Local name from the extension, falling back to the AP name. */
  sourceName: string;
  version: string;
  description: string;
  keywords: string[];
  profile: boolean;
  dependencies: ApDependency[];
  overrides: PluginOverrides;
  needs: string[];
  defaultEnvironment?: string;
  resources: ResourceCreateInput[];
  /** `type:name` → harness slugs. Missing means All. */
  harnessScopes?: Record<string, string[]>;
  /** `extensions["com.harnesstap"].upstream`, when complete and valid. */
  upstream?: PluginUpstream;
  /** Valid `exclude` entries; only set with an extends upstream. */
  exclude?: string[];
  /** Claude marketplace/plugin config from `com.harnesstap/claude.toml`. */
  claude?: ClaudePluginConfig;
  /** Spec load report from the package that was imported. */
  loadReport?: ApLoadReport;
  author?: Plugin["author"];
  homepage?: string;
  repository?: string;
  license?: string;
  opaqueExtensions?: Record<string, unknown>;
  opaqueFiles?: ApPackageFiles;
}

export interface ImportApPackageOptions {
  /** Local plugin name; defaults to the extension's `sourceName`. */
  as?: string;
  /** Defaults to `authored`; the catalog installer passes `catalog`. */
  origin?: PluginOrigin;
  /**
   * Copy the package into the owned install cache. Catalog show previews
   * pass false so a temporary plugin does not leave files behind.
   */
  installPackage?: boolean;
  /** Set for an embedded package: `exclude` is root only, so it is ignored. */
  nested?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileText(entry: { encoding: "utf8" | "base64"; content: string }): string {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64").toString("utf8")
    : entry.content;
}

function isDependencySourceKind(value: unknown): value is DependencySourceKind {
  return (
    typeof value === "string" &&
    (DEPENDENCY_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

function parseOverrides(raw: unknown): PluginOverrides {
  if (!isRecord(raw)) {
    return { versions: {}, resources: {} };
  }
  const versions: Record<string, string> = {};
  const resources: Record<string, string> = {};
  if (isRecord(raw.versions)) {
    for (const [key, value] of Object.entries(raw.versions)) {
      if (typeof value === "string") versions[key] = value;
    }
  }
  if (isRecord(raw.resources)) {
    for (const [key, value] of Object.entries(raw.resources)) {
      if (typeof value === "string") resources[key] = value;
    }
  }
  return { versions, resources };
}

function parseDependencies(raw: unknown): ApDependency[] {
  if (!Array.isArray(raw)) return [];
  const dependencies: ApDependency[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    dependencies.push({
      name: entry.name,
      constraint: typeof entry.constraint === "string" ? entry.constraint : "*",
      source: isDependencySourceKind(entry.source) ? entry.source : "local",
    });
  }
  return dependencies;
}

function parseHarnessScopes(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return {};
  const scopes: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = parseHarnessScope(value);
    if (parsed.kind === "subset") {
      scopes[key] = [...parsed.harnesses];
    }
  }
  return scopes;
}

function parseExtension(
  raw: unknown,
  apName: string,
): Pick<
  HarnesstapExtension,
  | "sourceName"
  | "profile"
  | "dependencies"
  | "overrides"
  | "needs"
  | "defaultEnvironment"
  | "harnessScopes"
  | "upstream"
  | "exclude"
> {
  if (!isRecord(raw)) {
    return {
      sourceName: apName,
      profile: false,
      dependencies: [],
      overrides: { versions: {}, resources: {} },
      needs: [],
    };
  }

  const harnessScopes = parseHarnessScopes(raw.harnessScopes);
  const upstream = parseUpstream(raw.upstream);
  // exclude only means something on an extends link.
  const exclude = upstream?.kind === "extends" ? parseExcludeList(raw.exclude) : [];
  return {
    sourceName: typeof raw.sourceName === "string" && raw.sourceName.length > 0
      ? raw.sourceName
      : apName,
    profile: raw.profile === true,
    dependencies: parseDependencies(raw.dependencies),
    overrides: parseOverrides(raw.overrides),
    needs: Array.isArray(raw.needs)
      ? raw.needs.filter((entry): entry is string => typeof entry === "string")
      : [],
    ...(typeof raw.defaultEnvironment === "string" && raw.defaultEnvironment.length > 0
      ? { defaultEnvironment: raw.defaultEnvironment }
      : {}),
    ...(Object.keys(harnessScopes).length > 0 ? { harnessScopes } : {}),
    ...(upstream ? { upstream } : {}),
    ...(exclude.length > 0 ? { exclude } : {}),
  };
}

function nativeBasename(relativePath: string, prefix: string): string {
  const rest = relativePath.slice(prefix.length);
  const base = rest.split("/").pop() ?? rest;
  return base.replace(/\.(agent|prompt|instructions)\.md$/i, "").replace(/\.md$/i, "");
}

function parseNativeMarkdownResources(
  type: ResourceType,
  dirName: string,
  files: ApPackageFiles,
): ResourceCreateInput[] {
  const prefix = `${dirName}/`;
  const resources: ResourceCreateInput[] = [];
  for (const relativePath of Object.keys(files).sort()) {
    if (!relativePath.startsWith(prefix) || !relativePath.endsWith(".md")) continue;
    const entry = files[relativePath];
    if (!entry) continue;
    const parsed = matter(fileText(entry));
    const data = isRecord(parsed.data) ? { ...parsed.data } : {};
    const fallback = nativeBasename(relativePath, prefix);
    const name =
      typeof data.name === "string" && data.name.length > 0 ? data.name : fallback;
    const description = typeof data.description === "string" ? data.description : "";
    delete data.name;
    delete data.description;
    resources.push({
      type,
      name,
      description,
      content: parsed.content,
      metadata: data,
      source: RESOURCE_SOURCE,
    });
  }
  return resources;
}

function parseNativeHookResources(files: ApPackageFiles): ResourceCreateInput[] {
  const resources: ResourceCreateInput[] = [];
  const hookPaths = Object.keys(files)
    .filter((path) => path === "hooks.json" || /^hooks\/.+\.json$/.test(path))
    .sort();
  for (const relativePath of hookPaths) {
    const entry = files[relativePath];
    if (!entry) continue;
    const parsed = parseHooksJsonContent(fileText(entry), relativePath);
    if (parsed.length > 0) {
      resources.push(
        ...parsed.map((resource) => ({ ...resource, source: RESOURCE_SOURCE })),
      );
      continue;
    }
    const name = relativePath.replace(/^hooks\//, "").replace(/\.json$/i, "").replaceAll("/", "-");
    resources.push({
      type: "hook",
      name: name || "hook",
      description: "",
      content: fileText(entry),
      metadata: {},
      source: RESOURCE_SOURCE,
    });
  }
  return resources;
}

function parseMarkdownComponent(
  type: ResourceType,
  layoutPath: string,
  files: ApPackageFiles,
): ResourceCreateInput[] {
  const prefix = `${layoutPath}/`;
  const resources: ResourceCreateInput[] = [];

  for (const relativePath of Object.keys(files).sort()) {
    if (!relativePath.startsWith(prefix) || !relativePath.endsWith(".md")) continue;
    const entry = files[relativePath];
    if (!entry) continue;

    const basename = relativePath.slice(prefix.length, -".md".length);
    if (!basename || basename.includes("/")) continue;

    const parsed = matter(fileText(entry));
    const data = isRecord(parsed.data) ? { ...parsed.data } : {};
    const name =
      typeof data.name === "string" && data.name.length > 0 ? data.name : basename;
    const description = typeof data.description === "string" ? data.description : "";
    delete data.name;
    delete data.description;

    resources.push({
      type,
      name,
      description,
      content: parsed.content,
      metadata: data,
      source: RESOURCE_SOURCE,
    });
  }

  return resources;
}

function parseTomlComponent(
  type: ResourceType,
  layout: { path: string; key: string },
  files: ApPackageFiles,
): ResourceCreateInput[] {
  const entry = files[layout.path];
  if (!entry) return [];

  const document = parseTransportToml(fileText(entry), layout.path);

  if (type === "env_var") {
    const vars = document.vars;
    if (!isRecord(vars)) return [];
    return Object.keys(vars)
      .sort()
      .map((key) => ({
        type: "env_var" as const,
        name: key,
        description: "",
        content: "",
        metadata: { key, value: String(vars[key] ?? "") },
        source: RESOURCE_SOURCE,
      }));
  }

  const rows = document[layout.key];
  if (!Array.isArray(rows)) return [];

  const resources: ResourceCreateInput[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.name !== "string") continue;
    const { name, description, content, ...metadata } = row;
    resources.push({
      type,
      name,
      description: typeof description === "string" ? description : "",
      content: typeof content === "string" ? content : "",
      metadata,
      source: RESOURCE_SOURCE,
    });
  }
  return resources;
}

function parseComponentResources(files: ApPackageFiles): ResourceCreateInput[] {
  const resources: ResourceCreateInput[] = [];

  for (const [type, layout] of Object.entries(COMPONENT_LAYOUT)) {
    if (!layout) continue;
    if (layout.path.endsWith(".toml")) {
      resources.push(...parseTomlComponent(type as ResourceType, layout, files));
    } else {
      resources.push(...parseMarkdownComponent(type as ResourceType, layout.path, files));
    }
  }

  return resources;
}

function parseClaudeConfig(files: ApPackageFiles): ClaudePluginConfig | undefined {
  const entry = files[`${HT_EXTENSION_NAMESPACE}/claude.toml`];
  if (!entry) return undefined;

  const document = parseTransportToml(fileText(entry), "claude config");
  const { schema: _schema, ...rest } = document;
  if (!isRecord(rest) || Object.keys(rest).length === 0) {
    return undefined;
  }
  return rest as ClaudePluginConfig;
}

export function parseApPackageFiles(
  files: ApPackageFiles,
  options?: { root?: string },
): ParsedApPackage {
  const loaded = loadSpecPackage(files, options?.root ? { root: options.root } : undefined);
  if (!loaded.report.ok || !loaded.manifest) {
    throw new Error(loaded.report.rejected ?? "Invalid Agent Plugins package");
  }
  const manifest = loaded.manifest;
  const extension = parseExtension(loaded.extension, manifest.name);

  const resources = [
    ...loaded.skills,
    ...loaded.mcp,
    ...parseNativeMarkdownResources("agent", "agents", files),
    ...parseNativeMarkdownResources("command", "commands", files),
    ...parseNativeHookResources(files),
    ...parseComponentResources(files),
  ];

  const claude = parseClaudeConfig(files);
  const opaque = collectOpaquePackage(files, manifest.extensions);
  const author = specAuthor(manifest.author);

  return {
    name: manifest.name,
    sourceName: extension.sourceName,
    version: loaded.report.version ?? manifest.version,
    description: manifest.description ?? "",
    keywords: manifest.keywords ?? [],
    profile: extension.profile,
    dependencies: extension.dependencies,
    overrides: extension.overrides,
    needs: extension.needs,
    ...(extension.defaultEnvironment
      ? { defaultEnvironment: extension.defaultEnvironment }
      : {}),
    resources,
    ...(extension.harnessScopes ? { harnessScopes: extension.harnessScopes } : {}),
    ...(extension.upstream ? { upstream: extension.upstream } : {}),
    ...(extension.exclude ? { exclude: extension.exclude } : {}),
    ...(claude ? { claude } : {}),
    loadReport: loaded.report,
    ...(author ? { author } : {}),
    ...(typeof manifest.homepage === "string" ? { homepage: manifest.homepage } : {}),
    ...(typeof manifest.repository === "string" ? { repository: manifest.repository } : {}),
    ...(typeof manifest.license === "string" ? { license: manifest.license } : {}),
    ...(Object.keys(opaque.extensions).length > 0 ? { opaqueExtensions: opaque.extensions } : {}),
    ...(Object.keys(opaque.files).length > 0 ? { opaqueFiles: opaque.files } : {}),
  };
}

function specAuthor(value: unknown): Plugin["author"] | undefined {
  if (!isRecord(value)) return undefined;
  const author: NonNullable<Plugin["author"]> = {};
  if (typeof value.name === "string") author.name = value.name;
  if (typeof value.email === "string") author.email = value.email;
  if (typeof value.url === "string") author.url = value.url;
  return Object.keys(author).length > 0 ? author : undefined;
}

export function readApPackage(packageDir: string): ParsedApPackage {
  return parseApPackageFiles(readContainedPackageFiles(packageDir), { root: packageDir });
}

function collectEmbeddedPackageNames(files: ApPackageFiles): string[] {
  const prefix = `${HT_EXTENSION_NAMESPACE}/embedded/`;
  const names = new Set<string>();
  for (const relativePath of Object.keys(files)) {
    if (!relativePath.startsWith(prefix)) continue;
    const rest = relativePath.slice(prefix.length);
    const name = rest.split("/")[0];
    if (name) names.add(name);
  }
  return [...names].sort();
}

function extractEmbeddedFiles(files: ApPackageFiles, name: string): ApPackageFiles {
  const prefix = `${HT_EXTENSION_NAMESPACE}/embedded/${name}/`;
  const nested: ApPackageFiles = {};
  for (const relativePath of Object.keys(files).sort()) {
    if (!relativePath.startsWith(prefix)) continue;
    const entry = files[relativePath];
    if (!entry) continue;
    nested[relativePath.slice(prefix.length)] = entry;
  }
  return nested;
}

export function importApPackageFiles(
  files: ApPackageFiles,
  options?: ImportApPackageOptions,
): Plugin {
  const parsed = parseApPackageFiles(files);

  const tags = [...parsed.keywords];
  if (parsed.profile && !tags.includes("profile")) {
    tags.push("profile");
  }

  const defaultEnvironmentId = parsed.defaultEnvironment
    ? getEnvironmentByName(parsed.defaultEnvironment)?.id
    : undefined;

  const targetName = options?.as ?? parsed.sourceName;
  if (parsed.upstream) {
    // Refuse before anything is written, so a bad package leaves no rows.
    assertNoExtendsCycle({ id: "", name: targetName } as Plugin, parsed.upstream);
  }

  const plugin = createPlugin({
    name: targetName,
    version: parsed.version,
    description: parsed.description,
    tags,
    origin: options?.origin ?? "authored",
    ...(parsed.needs.length > 0 ? { needs: parsed.needs } : {}),
    ...(parsed.claude ? { claude: parsed.claude } : {}),
    ...(defaultEnvironmentId ? { default_environment_id: defaultEnvironmentId } : {}),
  });

  if (
    parsed.author ||
    parsed.homepage ||
    parsed.repository ||
    parsed.license ||
    parsed.opaqueExtensions
  ) {
    setPluginSpecMetadata(plugin.id, {
      ...(parsed.author ? { author: parsed.author } : {}),
      ...(parsed.homepage ? { homepage: parsed.homepage } : {}),
      ...(parsed.repository ? { repository: parsed.repository } : {}),
      ...(parsed.license ? { license: parsed.license } : {}),
      ...(parsed.opaqueExtensions ? { opaqueExtensions: parsed.opaqueExtensions } : {}),
    });
  }
  if (parsed.opaqueFiles) {
    replaceOpaqueFiles(plugin.id, parsed.opaqueFiles);
  }
  if (parsed.upstream) {
    setPluginUpstream(plugin.id, parsed.upstream);
    if (parsed.exclude && !options?.nested) {
      writePluginExcludes(plugin.id, parsed.exclude);
    }
  }
  if (options?.installPackage !== false) {
    installAgentPluginPackage({ name: plugin.name, version: plugin.version }, files);
  }

  if (parsed.profile && !plugin.tags.includes("profile")) {
    setPluginTags(plugin.id, [...plugin.tags, "profile"]);
  }

  for (const resourceInput of parsed.resources) {
    const resource = createResource(resourceInput);
    addResourceToPlugin(plugin.id, resource.id);
    const scope = parsed.harnessScopes?.[`${resource.type}:${resource.name}`];
    if (scope && scope.length > 0) {
      setPluginResourceHarnessScope(plugin.id, resource.id, parseHarnessScope(scope));
    }
  }

  const embeddedNames = collectEmbeddedPackageNames(files);
  for (const embeddedName of embeddedNames) {
    importApPackageFiles(extractEmbeddedFiles(files, embeddedName), {
      origin: options?.origin ?? "authored",
      nested: true,
      ...(options?.installPackage === false ? { installPackage: false } : {}),
    });
  }

  for (const dependency of parsed.dependencies) {
    addDependency(plugin.id, dependency.name, {
      versionConstraint: dependency.constraint,
      ...(embeddedNames.includes(dependency.name) ? { embedOnExport: true } : {}),
      // Dependencies come with the package: the import is not an edit (#499).
      markDirty: false,
    });
  }

  for (const [name, version] of Object.entries(parsed.overrides.versions)) {
    setPluginVersionOverride(plugin.id, name, version);
  }
  for (const [resourceKey, winningPluginName] of Object.entries(parsed.overrides.resources)) {
    setPluginResourceOverride(plugin.id, resourceKey, winningPluginName);
  }

  return plugin;
}
