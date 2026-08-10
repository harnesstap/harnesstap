import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { getPluginById, getPluginByName, getPluginResources } from "../../models/plugin-model.js";
import type {
  EnvVarMetadata,
  McpServerMetadata,
  Resource,
  SkillMetadata,
} from "../../types.js";
import { assertContainedPath, listContainedFiles, PathEscapeError } from "../../utils/path-containment.js";
import { listDependencies } from "../plugin-dependency.js";
import { emitSkillAuxiliaryFiles, listSkillAuxiliaryFiles } from "../skill-auxiliary.js";
import { formatTransportToml } from "../transport/write.js";
import {
  COMPONENT_LAYOUT,
  HT_EXTENSION_NAMESPACE,
  HT_EXTENSION_SCHEMA,
  buildApManifest,
} from "./manifest.js";
import { validateApManifest } from "./validate.js";

export const AP_PACKAGE_SCHEMA = "urn:harnesstap:ap-package:v1";

export interface ApPackageFile {
  encoding: "utf8" | "base64";
  content: string;
}

/** Relative POSIX path → file contents. Callers sort keys before hashing. */
export type ApPackageFiles = Record<string, ApPackageFile>;

export interface BuildApPackageOptions {
  /** Root to copy skill `scripts/` and `reference/` files from, when available. */
  skillSourceRoot?: string;
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

function mcpEntryFromResource(resource: Resource): Record<string, unknown> {
  const meta = resource.metadata as McpServerMetadata;
  const entry: Record<string, unknown> = {};
  if (meta.transport === "http" && meta.url) {
    entry.type = "http";
    entry.url = meta.url;
    if (meta.headers && Object.keys(meta.headers).length > 0) {
      entry.headers = meta.headers;
    }
  } else {
    if (meta.command) entry.command = meta.command;
    if (meta.args) entry.args = meta.args;
  }
  if (meta.env && Object.keys(meta.env).length > 0) {
    entry.env = meta.env;
  }
  return entry;
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

  const manifest = buildApManifest(pluginId);
  validateApManifest(manifest);
  putUtf8(files, "plugin.json", JSON.stringify(manifest, null, 2));

  const byType = partitionByType(getPluginResources(pluginId));

  const skills = byType.get("skill") ?? [];
  for (const resource of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    const skillMdPath = `skills/${resource.name}/SKILL.md`;
    putUtf8(
      files,
      skillMdPath,
      emitFrontmatter(
        { name: resource.name, description: resource.description },
        resource.content,
      ),
    );

    if (options?.skillSourceRoot) {
      const meta = resource.metadata as SkillMetadata;
      const scripts = meta.scripts ?? [];
      const references = meta.references ?? [];
      if (scripts.length > 0 || references.length > 0) {
        const sourceSkillDir = join(options.skillSourceRoot, resource.name);
        const listed = listSkillAuxiliaryFiles(sourceSkillDir);
        for (const aux of emitSkillAuxiliaryFiles({
          sourceSkillDir,
          targetPrefix: `skills/${resource.name}`,
          scripts: scripts.length > 0 ? scripts : listed.scripts,
          references: references.length > 0 ? references : listed.references,
        })) {
          putUtf8(files, aux.path, aux.content);
        }
      }
    }
  }

  const mcpServers = byType.get("mcp_server") ?? [];
  if (mcpServers.length > 0) {
    const mcpConfig: Record<string, Record<string, unknown>> = {};
    for (const resource of [...mcpServers].sort((a, b) => a.name.localeCompare(b.name))) {
      mcpConfig[resource.name] = mcpEntryFromResource(resource);
    }
    putUtf8(files, "mcp.json", JSON.stringify({ mcpServers: mcpConfig }, null, 2));
  }

  for (const type of MARKDOWN_COMPONENT_TYPES) {
    const layout = COMPONENT_LAYOUT[type];
    const resources = byType.get(type) ?? [];
    if (!layout || resources.length === 0) continue;
    for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
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
    const resources = byType.get(type) ?? [];
    if (!layout || resources.length === 0) continue;
    putUtf8(files, layout.path, formatTransportToml(buildTomlComponentDocument(type, resources)));
  }

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
    files[relativePath] = isProbablyText(buffer)
      ? { encoding: "utf8", content: buffer.toString("utf8") }
      : { encoding: "base64", content: buffer.toString("base64") };
  }
  return files;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  return !buffer.toString("utf8").includes("\uFFFD");
}
