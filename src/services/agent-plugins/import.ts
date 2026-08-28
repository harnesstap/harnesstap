import matter from "gray-matter";
import { getEnvironmentByName } from "../../models/environment.js";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginTags,
} from "../../models/plugin-model.js";
import { createResource } from "../../models/resource.js";
import type {
  ClaudePluginConfig,
  DependencySourceKind,
  Plugin,
  PluginOrigin,
  PluginOverrides,
  ResourceCreateInput,
  ResourceType,
  SkillMetadata,
} from "../../types.js";
import { DEPENDENCY_SOURCE_KINDS } from "../../types.js";
import { parseMcpServersDocument } from "../mcp-config-bridge.js";
import { addDependency } from "../plugin-dependency.js";
import {
  setPluginResourceOverride,
  setPluginVersionOverride,
} from "../plugin-overrides.js";
import { parseHooksJsonContent } from "../hook-serialization.js";
import { parseTransportToml } from "../toml/read.js";
import type { ApPackageFile, ApPackageFiles } from "./files.js";
import { readApPackageFiles } from "./files.js";
import type { ApDependency, ApManifest, HarnesstapExtension } from "./manifest.js";
import { COMPONENT_LAYOUT, HT_EXTENSION_NAMESPACE } from "./manifest.js";
import { validateApManifest } from "./validate.js";

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
  /** Claude marketplace/plugin config from `com.harnesstap/claude.toml`. */
  claude?: ClaudePluginConfig;
}

export interface ImportApPackageOptions {
  /** Local plugin name; defaults to the extension's `sourceName`. */
  as?: string;
  /** Defaults to `authored`; the catalog installer passes `catalog`. */
  origin?: PluginOrigin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileText(entry: ApPackageFile): string {
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

function parseExtension(
  raw: unknown,
  apName: string,
): Pick<
  HarnesstapExtension,
  "sourceName" | "profile" | "dependencies" | "overrides" | "needs" | "defaultEnvironment"
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
  };
}

function listSkillAuxNames(
  files: ApPackageFiles,
  skillName: string,
  kind: "scripts" | "reference" | "references",
): string[] {
  const prefix = `skills/${skillName}/${kind}/`;
  const names: string[] = [];
  for (const relativePath of Object.keys(files)) {
    if (!relativePath.startsWith(prefix)) continue;
    const rest = relativePath.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    names.push(rest);
  }
  return names.sort();
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

function parseSkillResources(files: ApPackageFiles): ResourceCreateInput[] {
  const resources: ResourceCreateInput[] = [];
  const skillPaths = Object.keys(files)
    .filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path))
    .sort();

  for (const relativePath of skillPaths) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(relativePath);
    if (!match?.[1]) continue;
    const skillName = match[1];
    const entry = files[relativePath];
    if (!entry) continue;

    const parsed = matter(fileText(entry));
    const data = isRecord(parsed.data) ? parsed.data : {};
    const name = typeof data.name === "string" && data.name.length > 0 ? data.name : skillName;
    const description = typeof data.description === "string" ? data.description : "";

    const scripts = listSkillAuxNames(files, skillName, "scripts");
    const references = [
      ...listSkillAuxNames(files, skillName, "reference"),
      ...listSkillAuxNames(files, skillName, "references"),
    ].filter((value, index, all) => all.indexOf(value) === index)
      .sort();

    const metadata: SkillMetadata = {};
    if (scripts.length > 0) metadata.scripts = scripts;
    if (references.length > 0) metadata.references = references;

    resources.push({
      type: "skill",
      name,
      description,
      content: parsed.content,
      metadata,
      source: RESOURCE_SOURCE,
    });
  }

  return resources;
}

function parseMcpResources(files: ApPackageFiles): ResourceCreateInput[] {
  const entry = files["mcp.json"];
  if (!entry) return [];

  let document: unknown;
  try {
    document = JSON.parse(fileText(entry)) as unknown;
  } catch {
    throw new Error("Invalid mcp.json — expected JSON");
  }

  const servers = parseMcpServersDocument(document);
  return Object.keys(servers)
    .sort()
    .map((name) => {
      const metadata = servers[name];
      if (!metadata) {
        throw new Error(`Missing MCP server metadata for "${name}"`);
      }
      return {
        type: "mcp_server" as const,
        name,
        description: "",
        content: "",
        metadata,
        source: RESOURCE_SOURCE,
      };
    });
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

export function parseApPackageFiles(files: ApPackageFiles): ParsedApPackage {
  const manifestEntry = files["plugin.json"];
  if (!manifestEntry) {
    throw new Error("Missing plugin.json — not an Agent Plugins package");
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fileText(manifestEntry)) as unknown;
  } catch {
    throw new Error("Invalid plugin.json — expected JSON");
  }

  validateApManifest(manifestRaw);
  const manifest = manifestRaw as ApManifest;

  const extension = parseExtension(
    manifest.extensions?.[HT_EXTENSION_NAMESPACE],
    manifest.name,
  );

  const resources = [
    ...parseSkillResources(files),
    ...parseMcpResources(files),
    ...parseNativeMarkdownResources("agent", "agents", files),
    ...parseNativeMarkdownResources("command", "commands", files),
    ...parseNativeHookResources(files),
    ...parseComponentResources(files),
  ];

  const claude = parseClaudeConfig(files);

  return {
    name: manifest.name,
    sourceName: extension.sourceName,
    version: manifest.version,
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
    ...(claude ? { claude } : {}),
  };
}

export function readApPackage(packageDir: string): ParsedApPackage {
  return parseApPackageFiles(readApPackageFiles(packageDir));
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

  const plugin = createPlugin({
    name: options?.as ?? parsed.sourceName,
    version: parsed.version,
    description: parsed.description,
    tags,
    origin: options?.origin ?? "authored",
    ...(parsed.needs.length > 0 ? { needs: parsed.needs } : {}),
    ...(parsed.claude ? { claude: parsed.claude } : {}),
    ...(defaultEnvironmentId ? { default_environment_id: defaultEnvironmentId } : {}),
  });

  if (parsed.profile && !plugin.tags.includes("profile")) {
    setPluginTags(plugin.id, [...plugin.tags, "profile"]);
  }

  for (const resourceInput of parsed.resources) {
    const resource = createResource(resourceInput);
    addResourceToPlugin(plugin.id, resource.id);
  }

  const embeddedNames = collectEmbeddedPackageNames(files);
  for (const embeddedName of embeddedNames) {
    importApPackageFiles(extractEmbeddedFiles(files, embeddedName), {
      origin: options?.origin ?? "authored",
    });
  }

  for (const dependency of parsed.dependencies) {
    addDependency(plugin.id, dependency.name, {
      versionConstraint: dependency.constraint,
      ...(embeddedNames.includes(dependency.name) ? { embedOnExport: true } : {}),
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
