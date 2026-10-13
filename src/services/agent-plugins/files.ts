import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { getPluginById, getPluginByName, getPluginResources } from "../../models/plugin-model.js";
import { getResource } from "../../models/resource.js";
import type {
  EnvVarMetadata,
  McpServerMetadata,
  Resource,
} from "../../types.js";
import { assertContainedPath, listContainedFiles, PathEscapeError } from "../../utils/path-containment.js";
import { listDependencies } from "../plugin-dependency.js";
import { emitSkillAuxiliaryFiles } from "../skill-auxiliary.js";
import { formatTransportToml } from "../toml/write.js";
import {
  type ApManifest,
  buildApManifest,
  COMPONENT_LAYOUT,
  type HarnesstapExtension,
  HT_EXTENSION_NAMESPACE,
  HT_EXTENSION_SCHEMA,
} from "./manifest.js";
import { isValidAgentSkillName, slugifyAgentSkillName, slugifyApName } from "./name.js";
import {
  buildSpecMcpJson,
  formatMcpExtrasToml,
  formatSpecMcpJson,
  HT_MCP_EXTRAS_PATH,
} from "./spec-mcp.js";
import { AP_SCHEMA_URL, validateApManifest } from "./validate.js";

export const AP_PACKAGE_SCHEMA = "urn:harnesstap:ap-package:v1";

export interface ApPackageFile {
  encoding: "utf8" | "base64";
  content: string;
}

/** Relative POSIX path → file contents. Callers sort keys before hashing. */
export type ApPackageFiles = Record<string, ApPackageFile>;

export interface BuildApPackageOptions {
  /** Root to copy skill companion trees from, when available. */
  skillSourceRoot?: string;
  /** Export renames and secret moves are appended here and printed. */
  warnings?: string[];
}

export interface SkillExportPlan {
  dirById: Map<string, string>;
  skillNames: Record<string, string>;
  warnings: string[];
}

export function planSkillExport(resources: readonly Resource[]): SkillExportPlan {
  const dirById = new Map<string, string>();
  const skillNames: Record<string, string> = {};
  const warnings: string[] = [];
  const used = new Set<string>();
  const skills = resources
    .filter((resource) => resource.type === "skill")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const resource of skills) {
    let dir = isValidAgentSkillName(resource.name)
      ? resource.name
      : slugifyAgentSkillName(resource.name);
    if (used.has(dir)) {
      let suffix = 2;
      let candidate = `${dir}-${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${dir}-${suffix}`;
      }
      dir = candidate.length > 64 ? slugifyAgentSkillName(candidate) : candidate;
    }
    used.add(dir);
    dirById.set(resource.id, dir);
    if (dir !== resource.name) {
      skillNames[dir] = resource.name;
      warnings.push(
        `skill "${resource.name}" was renamed to "${dir}" for Agent Skills; the original name is kept in com.harnesstap`,
      );
    }
  }
  return { dirById, skillNames, warnings };
}

function noteWarnings(warnings: string[], options: BuildApPackageOptions | undefined): void {
  if (warnings.length === 0) return;
  if (options) {
    options.warnings ??= [];
    options.warnings.push(...warnings);
  }
  for (const warning of warnings) {
    console.error(`warning: ${warning}`);
  }
}

const MARKDOWN_COMPONENT_TYPES = ["instruction", "rule", "agent", "command"] as const;
const TOML_COMPONENT_TYPES = ["hook", "permission", "env_var", "model_config"] as const;

type TomlComponentType = (typeof TOML_COMPONENT_TYPES)[number];

function emitFrontmatter(data: Record<string, unknown>, content: string): string {
  const nonEmpty = Object.entries(data).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (nonEmpty.length === 0) return content;
  return matter.stringify(content, Object.fromEntries(nonEmpty));
}

function put(files: ApPackageFiles, relativePath: string, entry: ApPackageFile): void {
  // Reject raw `..` segments even when resolve() would keep the path inside the root
  // (e.g. skills/../escape/SKILL.md → escape/SKILL.md).
  if (relativePath.split("/").includes("..")) {
    throw new PathEscapeError(relativePath, ".");
  }
  assertContainedPath(".", relativePath);
  files[relativePath] = entry;
}

function putUtf8(files: ApPackageFiles, relativePath: string, content: string): void {
  put(files, relativePath, { encoding: "utf8", content });
}

/** The MCP fields package export has always carried. */
function exportedMcpMetadata(resource: Resource): McpServerMetadata {
  const meta = resource.metadata as McpServerMetadata;
  return {
    transport: meta.transport,
    ...(meta.command !== undefined ? { command: meta.command } : {}),
    ...(meta.url !== undefined ? { url: meta.url } : {}),
    ...(meta.args !== undefined ? { args: meta.args } : {}),
    ...(meta.env !== undefined ? { env: meta.env } : {}),
    ...(meta.headers !== undefined ? { headers: meta.headers } : {}),
    ...(meta.connection_type !== undefined ? { connection_type: meta.connection_type } : {}),
  };
}

function buildTomlComponentDocument(
  type: TomlComponentType,
  resources: Resource[],
): Record<string, unknown> {
  const layout = COMPONENT_LAYOUT[type];
  if (!layout) {
    throw new Error(`Missing COMPONENT_LAYOUT for type: ${type}`);
  }

  if (type === "env_var") {
    const vars: Record<string, string> = {};
    for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
      const meta = resource.metadata as EnvVarMetadata;
      const key = meta.key || resource.name;
      vars[key] = meta.value;
    }
    return { schema: HT_EXTENSION_SCHEMA, vars };
  }

  const entries = [...resources]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((resource) => {
      const row: Record<string, unknown> = {
        name: resource.name,
        ...(resource.description ? { description: resource.description } : {}),
        ...(resource.content ? { content: resource.content } : {}),
        ...resource.metadata,
      };
      return row;
    });

  return { schema: HT_EXTENSION_SCHEMA, [layout.key]: entries };
}

function partitionByType(resources: Resource[]): Map<string, Resource[]> {
  const byType = new Map<string, Resource[]>();
  for (const resource of resources) {
    const list = byType.get(resource.type) ?? [];
    list.push(resource);
    byType.set(resource.type, list);
  }
  return byType;
}

function componentsForResources(resources: Resource[]): Record<string, string> {
  const present = new Set(resources.map((resource) => resource.type));
  const components: Record<string, string> = {};
  for (const [type, layout] of Object.entries(COMPONENT_LAYOUT)) {
    if (present.has(type as never)) components[layout.key] = layout.path;
  }
  return components;
}

function emitResourceFiles(
  files: ApPackageFiles,
  resources: Resource[],
  skillPlan: SkillExportPlan,
  options?: BuildApPackageOptions,
): string[] {
  const warnings: string[] = [];
  const byType = partitionByType(resources);

  const skills = byType.get("skill") ?? [];
  for (const resource of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = skillPlan.dirById.get(resource.id) ?? resource.name;
    const skillMdPath = `skills/${dir}/SKILL.md`;
    putUtf8(
      files,
      skillMdPath,
      emitFrontmatter(
        { name: dir, description: resource.description },
        resource.content,
      ),
    );

    if (options?.skillSourceRoot) {
      const sourceSkillDir = join(options.skillSourceRoot, resource.name);
      for (const aux of emitSkillAuxiliaryFiles({
        sourceSkillDir,
        targetPrefix: `skills/${dir}`,
      })) {
        put(files, aux.path, {
          encoding: aux.encoding === "base64" ? "base64" : "utf8",
          content: aux.content,
        });
      }
    }
  }

  const mcpServers = byType.get("mcp_server") ?? [];
  if (mcpServers.length > 0) {
    const servers: Record<string, McpServerMetadata> = {};
    for (const resource of mcpServers) {
      servers[resource.name] = exportedMcpMetadata(resource);
    }
    const { document, extras, warnings: mcpWarnings } = buildSpecMcpJson(servers);
    putUtf8(files, "mcp.json", formatSpecMcpJson(document));
    if (Object.keys(extras).length > 0) {
      putUtf8(files, HT_MCP_EXTRAS_PATH, formatMcpExtrasToml(extras));
    }
    warnings.push(...mcpWarnings);
  }

  for (const type of MARKDOWN_COMPONENT_TYPES) {
    const layout = COMPONENT_LAYOUT[type];
    const typedResources = byType.get(type) ?? [];
    if (!layout || typedResources.length === 0) continue;
    for (const resource of [...typedResources].sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = `${layout.path}/${resource.name}.md`;
      putUtf8(
        files,
        relativePath,
        emitFrontmatter(
          {
            name: resource.name,
            description: resource.description,
            ...resource.metadata,
          },
          resource.content,
        ),
      );
    }
  }

  for (const type of TOML_COMPONENT_TYPES) {
    const layout = COMPONENT_LAYOUT[type];
    const typedResources = byType.get(type) ?? [];
    if (!layout || typedResources.length === 0) continue;
    putUtf8(
      files,
      layout.path,
      formatTransportToml(buildTomlComponentDocument(type, typedResources)),
    );
  }
  return warnings;
}

function applySkillNames(manifest: ApManifest, skillNames: Record<string, string>): void {
  if (Object.keys(skillNames).length === 0) return;
  const extension = manifest.extensions?.[HT_EXTENSION_NAMESPACE];
  if (!extension || !("schema" in extension)) return;
  extension.skillNames = skillNames;
}

function buildApPackageFilesInner(
  pluginId: string,
  options: BuildApPackageOptions | undefined,
  visited: Set<string>,
): ApPackageFiles {
  if (visited.has(pluginId)) {
    throw new Error(
      `Cycle detected while embedding plugins: ${[...visited, pluginId].join(" -> ")}`,
    );
  }
  visited.add(pluginId);

  const plugin = getPluginById(pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

  const files: ApPackageFiles = {};
  const resources = getPluginResources(pluginId);
  const skillPlan = planSkillExport(resources);
  const manifest = buildApManifest(pluginId);
  applySkillNames(manifest, skillPlan.skillNames);
  validateApManifest(manifest);
  putUtf8(files, "plugin.json", JSON.stringify(manifest, null, 2));

  const warnings = emitResourceFiles(files, resources, skillPlan, options);
  noteWarnings([...skillPlan.warnings, ...warnings], options);

  if (plugin.claude) {
    putUtf8(
      files,
      `${HT_EXTENSION_NAMESPACE}/claude.toml`,
      formatTransportToml({
        schema: HT_EXTENSION_SCHEMA,
        ...plugin.claude,
      }),
    );
  }

  for (const dependency of listDependencies(pluginId)) {
    if (!dependency.embed_on_export) continue;
    const embedded = getPluginByName(dependency.name);
    if (!embedded) {
      throw new Error(
        `Cannot embed dependency "${dependency.name}": plugin not found in the local library`,
      );
    }
    const nested = buildApPackageFilesInner(
      embedded.id,
      options,
      new Set(visited),
    );
    for (const relativePath of Object.keys(nested).sort()) {
      const entry = nested[relativePath];
      if (!entry) continue;
      put(
        files,
        `${HT_EXTENSION_NAMESPACE}/embedded/${dependency.name}/${relativePath}`,
        entry,
      );
    }
  }

  return files;
}

export function buildApPackageFiles(
  pluginId: string,
  options?: BuildApPackageOptions,
): ApPackageFiles {
  return buildApPackageFilesInner(pluginId, options, new Set());
}

/** One-resource throwaway package: manifest name is slugified; version is always 0.0.0. */
export function buildApPackageFilesForResource(resourceId: string): ApPackageFiles {
  const resource = getResource(resourceId);
  if (!resource) throw new Error(`Resource not found: ${resourceId}`);

  const files: ApPackageFiles = {};
  const apName = slugifyApName(resource.name);
  const skillPlan = planSkillExport([resource]);
  const extension: HarnesstapExtension = {
    schema: HT_EXTENSION_SCHEMA,
    sourceName: resource.name,
    profile: false,
    dependencies: [],
    overrides: { versions: {}, resources: {} },
    needs: [],
    components: componentsForResources([resource]),
    ...(Object.keys(skillPlan.skillNames).length > 0 ? { skillNames: skillPlan.skillNames } : {}),
  };
  const manifest: ApManifest = {
    $schema: AP_SCHEMA_URL,
    name: apName,
    version: "0.0.0",
    ...(resource.description ? { description: resource.description } : {}),
    extensions: { [HT_EXTENSION_NAMESPACE]: extension },
  };
  validateApManifest(manifest);
  putUtf8(files, "plugin.json", JSON.stringify(manifest, null, 2));
  const warnings = emitResourceFiles(files, [resource], skillPlan);
  noteWarnings([...skillPlan.warnings, ...warnings], undefined);
  return files;
}

export function writeApPackageFiles(files: ApPackageFiles, targetDir: string): string[] {
  const written: string[] = [];
  for (const relativePath of Object.keys(files).sort()) {
    assertContainedPath(targetDir, relativePath);
    const entry = files[relativePath];
    if (!entry) continue;
    const absolute = join(targetDir, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      entry.encoding === "base64" ? Buffer.from(entry.content, "base64") : entry.content,
    );
    written.push(relativePath);
  }
  return written;
}

export function readApPackageFiles(packageDir: string): ApPackageFiles {
  const files: ApPackageFiles = {};
  for (const relativePath of listContainedFiles(packageDir).sort()) {
    const buffer = readFileSync(join(packageDir, relativePath));
    files[relativePath] = packageFileFromBytes(buffer);
  }
  return files;
}

export function packageFileFromBytes(buffer: Buffer): ApPackageFile {
  return isProbablyText(buffer)
    ? { encoding: "utf8", content: buffer.toString("utf8") }
    : { encoding: "base64", content: buffer.toString("base64") };
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return !buffer.toString("utf8").includes("\uFFFD");
}
