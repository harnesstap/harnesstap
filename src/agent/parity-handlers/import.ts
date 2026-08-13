import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { requireAgentBearerAuth } from "../auth.js";
import { jsonResponse } from "../http.js";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getPlugin, addResourceToPlugin } from "../../models/plugin-model.js";
import { findResourceByKey, listResources, type ResourceCreateInput } from "../../models/resource.js";
import { upsertProject } from "../../models/project.js";
import { isProfilePlugin } from "../../constants/profile.js";
import {
  detectPlatforms,
  hasSharedProjectResourceFiles,
  isPluginSourcePath,
  persistMergedProjectScan,
  scanAndPersistPluginSource,
  scanProjectWithPluginSource,
} from "../../services/scanner.js";
import { scanPluginSource } from "../../services/plugin-source-import.js";
import { dropHarnessSkillsDuplicatingPluginSource } from "../../services/scan-dedup.js";
import { importSkillPackage } from "../../services/skill-package-import.js";
import { resolveSkillPackageCheckout } from "../../services/skill-package-resolve.js";
import {
  createPluginFromProject,
  previewPluginFromProject,
} from "../../services/plugin-from-project.js";
import { addPluginAttachment } from "../../services/plugin-composition.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "../../services/git.js";
import type { Plugin } from "../../types.js";

export type ImportKind = "scan" | "add" | "from_project";
export type ImportConflictPolicy = "skip" | "overwrite";

export interface ImportPreviewItem {
  type: string;
  name: string;
  description?: string;
  category?: string;
  platformId?: string;
  pluginName?: string;
}

export interface ImportConflict {
  type: string;
  name: string;
  platformId?: string;
}

type ParsedBody =
  | {
      kind: "scan";
      conflictPolicy: ImportConflictPolicy;
      projectPath: string;
      attachProfile?: string;
    }
  | {
      kind: "add";
      conflictPolicy: ImportConflictPolicy;
      source: string;
      attachProfile?: string;
    }
  | {
      kind: "from_project";
      conflictPolicy: ImportConflictPolicy;
      projectPath: string;
      name: string;
      description?: string;
      attachProfile?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pathnameOf(request: Request): string {
  return new URL(request.url).pathname;
}

function isImportPreview(request: Request): boolean {
  return request.method === "POST" && pathnameOf(request) === "/v1/import/preview";
}

function isImportCommit(request: Request): boolean {
  return request.method === "POST" && pathnameOf(request) === "/v1/import";
}

function invalidBody(message: string): Response {
  return jsonResponse({ error: "invalid_body", message }, { status: 400 });
}

function parseConflictPolicy(value: unknown): ImportConflictPolicy | Response {
  if (value === undefined || value === "skip") {
    return "skip";
  }
  if (value === "overwrite") {
    return "overwrite";
  }
  return invalidBody("conflictPolicy must be skip or overwrite");
}

function parseOptionalAttach(body: Record<string, unknown>): string | undefined | Response {
  const value = body.attachProfile;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidBody("attachProfile must be a non-empty string");
  }
  return value.trim();
}

function requireExistingDir(projectPath: string): string | Response {
  const resolved = resolve(projectPath);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    return invalidBody(`No such directory: ${projectPath}`);
  }
  return resolved;
}

async function parseBody(request: Request): Promise<ParsedBody | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  if (!isRecord(raw)) {
    return jsonResponse({ error: "invalid_body" }, { status: 400 });
  }
  const kind = raw.kind;
  if (kind !== "scan" && kind !== "add" && kind !== "from_project") {
    return invalidBody("kind must be scan, add, or from_project");
  }
  const conflictPolicy = parseConflictPolicy(raw.conflictPolicy);
  if (conflictPolicy instanceof Response) {
    return conflictPolicy;
  }
  const attachProfile = parseOptionalAttach(raw);
  if (attachProfile instanceof Response) {
    return attachProfile;
  }

  switch (kind) {
    case "scan": {
      if (typeof raw.projectPath !== "string" || raw.projectPath.trim().length === 0) {
        return invalidBody("projectPath is required");
      }
      return {
        kind,
        conflictPolicy,
        projectPath: raw.projectPath.trim(),
        ...(attachProfile ? { attachProfile } : {}),
      };
    }
    case "add": {
      if (typeof raw.source !== "string" || raw.source.trim().length === 0) {
        return invalidBody("source is required");
      }
      return {
        kind,
        conflictPolicy,
        source: raw.source.trim(),
        ...(attachProfile ? { attachProfile } : {}),
      };
    }
    case "from_project": {
      if (typeof raw.projectPath !== "string" || raw.projectPath.trim().length === 0) {
        return invalidBody("projectPath is required");
      }
      if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
        return invalidBody("name is required");
      }
      const description =
        raw.description === undefined
          ? undefined
          : typeof raw.description === "string"
            ? raw.description
            : null;
      if (description === null) {
        return invalidBody("description must be a string");
      }
      return {
        kind,
        conflictPolicy,
        projectPath: raw.projectPath.trim(),
        name: raw.name.trim(),
        ...(description !== undefined ? { description } : {}),
        ...(attachProfile ? { attachProfile } : {}),
      };
    }
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export async function tryHandle(
  request: Request,
  token: string,
  deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  if (!isImportPreview(request) && !isImportCommit(request)) {
    return null;
  }

  const authError = requireAgentBearerAuth(request, token);
  if (authError) {
    return authError;
  }

  if (isImportCommit(request) && deps.isAgentSwitchInProgress()) {
    return jsonResponse(
      { error: "switch_in_progress", message: "Another profile switch is already running" },
      { status: 409 },
    );
  }

  initializeSchema(getDb());

  const parsed = await parseBody(request);
  if (parsed instanceof Response) {
    return parsed;
  }

  if (parsed.kind === "scan" || parsed.kind === "from_project") {
    const dir = requireExistingDir(parsed.projectPath);
    if (dir instanceof Response) {
      return dir;
    }
    parsed.projectPath = dir;
  }

  try {
    if (isImportPreview(request)) {
      return jsonResponse(await previewImport(parsed));
    }
    return jsonResponse(await commitImport(parsed), { status: 201 });
  } catch (error) {
    return mapImportError(error, isImportPreview(request) ? "preview_failed" : "import_failed");
  }
}

function mapImportError(error: unknown, fallback: "preview_failed" | "import_failed"): Response {
  const message = errorMessage(error);
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code: unknown }).code === "resource_conflict"
  ) {
    return jsonResponse({ error: "resource_conflict", message }, { status: 409 });
  }
  if (message.startsWith("Plugin already exists:")) {
    return jsonResponse({ error: "plugin_exists", message }, { status: 409 });
  }
  if (message.startsWith("Profile not found:")) {
    return jsonResponse({ error: "not_found", message }, { status: 404 });
  }
  return jsonResponse({ error: fallback, message }, { status: 400 });
}

async function previewImport(input: ParsedBody): Promise<unknown> {
  switch (input.kind) {
    case "scan":
      return previewScan(input.projectPath);
    case "add":
      return previewAdd(input.source);
    case "from_project":
      return previewFromProject(input);
    default: {
      const neverKind: never = input;
      return neverKind;
    }
  }
}

async function previewScan(projectPath: string): Promise<unknown> {
  const detected = detectPlatforms(projectPath);
  const hasHarnessSignals =
    detected.length > 0 || hasSharedProjectResourceFiles(projectPath);
  const pluginSourceOnly = !hasHarnessSignals && isPluginSourcePath(projectPath);

  if (pluginSourceOnly) {
    const imports = await scanPluginSource(projectPath);
    const items: ImportPreviewItem[] = imports.flatMap((entry) =>
      entry.resources.map((resource) => ({
        type: resource.type,
        name: resource.name,
        description: resource.description,
        pluginName: entry.plugin_name,
      })),
    );
    return {
      kind: "scan",
      totalImports: items.length,
      warnings: items.length === 0
        ? ["No harness resources found in this directory."]
        : [],
      conflicts: [],
      items,
      pluginExists: false,
    };
  }

  if (!hasHarnessSignals && !isPluginSourcePath(projectPath)) {
    return {
      kind: "scan",
      totalImports: 0,
      warnings: [`No harness resources found in this directory (${projectPath}).`],
      conflicts: [],
      items: [],
      pluginExists: false,
    };
  }

  const { harness: rawHarness, plugin } = await scanProjectWithPluginSource(projectPath);
  const harness = dropHarnessSkillsDuplicatingPluginSource(rawHarness, plugin);
  const incomingResources: ResourceCreateInput[] = [
    ...harness.flatMap((result) => result.resources),
    ...plugin.flatMap((entry) => entry.resources),
  ];
  const items: ImportPreviewItem[] = [
    ...harness.flatMap((result) =>
      result.resources.map((resource) => ({
        type: resource.type,
        name: resource.name,
        description: resource.description,
        platformId: result.platformId,
      })),
    ),
    ...plugin.flatMap((entry) =>
      entry.resources.map((resource) => ({
        type: resource.type,
        name: resource.name,
        description: resource.description,
        pluginName: entry.plugin_name,
      })),
    ),
  ];
  const conflicts: ImportConflict[] = [];
  for (const resource of incomingResources) {
    const existing = findResourceByKey(
      resource.type,
      resource.name,
      resource.namespace ?? "",
    );
    if (existing && existing.content && resource.content !== existing.content) {
      conflicts.push({
        type: resource.type,
        name: resource.name,
      });
    }
  }
  return {
    kind: "scan",
    totalImports: items.length,
    warnings: items.length === 0
      ? ["No harness resources found in this directory."]
      : [],
    conflicts,
    items,
    pluginExists: false,
  };
}

async function previewAdd(source: string): Promise<unknown> {
  const resolved = resolveSkillPackageCheckout(source, getHarnesstapDir());
  const items: ImportPreviewItem[] = resolved.discovered.map((skill) => ({
    type: "skill",
    name: skill.name,
    description: skill.description,
    category: skill.category,
  }));
  return {
    kind: "add",
    totalImports: items.length,
    warnings: [],
    conflicts: [],
    items,
    namespace: resolved.namespace,
    pluginExists: false,
  };
}

async function previewFromProject(input: {
  projectPath: string;
  name: string;
}): Promise<unknown> {
  const preview = await previewPluginFromProject({
    name: input.name,
    projectRoot: input.projectPath,
  });
  const items: ImportPreviewItem[] = [
    ...preview.newResources.map((resource) => ({
      type: resource.type,
      name: resource.name,
      description: resource.description,
    })),
    ...preview.conflicts.map((conflict) => ({
      type: conflict.existingResource.type,
      name: conflict.existingResource.name,
      description: conflict.existingResource.description,
    })),
  ];
  return {
    kind: "from_project",
    totalImports: preview.totalImports,
    warnings: preview.totalImports === 0
      ? ["No harness resources found in this directory."]
      : [],
    conflicts: preview.conflicts.map((conflict) => ({
      type: conflict.existingResource.type,
      name: conflict.existingResource.name,
    })),
    items,
    pluginExists: preview.pluginExists,
  };
}

function resolveAttachProfile(name: string): Plugin {
  const plugin = getPlugin(name);
  if (!plugin || !isProfilePlugin(plugin)) {
    throw new Error(`Profile not found: ${name}`);
  }
  return plugin;
}

async function commitImport(input: ParsedBody): Promise<unknown> {
  const attachedProfile = input.attachProfile
    ? resolveAttachProfile(input.attachProfile)
    : undefined;

  switch (input.kind) {
    case "scan": {
      const result = await commitScan(input.projectPath, input.conflictPolicy);
      if (attachedProfile) {
        for (const resourceId of result.resourceIds) {
          addResourceToPlugin(attachedProfile.id, resourceId);
        }
      }
      return {
        ...result,
        ...(attachedProfile ? { attachedProfile: attachedProfile.name } : {}),
      };
    }
    case "add": {
      const result = await commitAdd(input.source);
      if (attachedProfile) {
        for (const resource of listResources().filter((row) =>
          result.resourceIds.includes(row.id),
        )) {
          await addPluginAttachment({
            plugin: attachedProfile,
            selector: `skill:${resource.name}@${result.namespace}`,
            type: "skill",
          });
        }
      }
      return {
        ...result,
        ...(attachedProfile ? { attachedProfile: attachedProfile.name } : {}),
      };
    }
    case "from_project": {
      const created = await createPluginFromProject({
        name: input.name,
        description: input.description,
        projectRoot: input.projectPath,
        conflictStrategy: input.conflictPolicy,
      });
      if (attachedProfile) {
        await addPluginAttachment({
          plugin: attachedProfile,
          selector: created.plugin.name,
          type: "plugin",
        });
      }
      return {
        kind: "from_project",
        totalImports: created.imported_count,
        resourceIds: created.resources.map((resource) => resource.id),
        plugin: { id: created.plugin.id, name: created.plugin.name },
        ...(attachedProfile ? { attachedProfile: attachedProfile.name } : {}),
      };
    }
    default: {
      const neverKind: never = input;
      return neverKind;
    }
  }
}

async function commitScan(
  projectPath: string,
  conflictPolicy: ImportConflictPolicy,
): Promise<{ kind: "scan"; totalImports: number; resourceIds: string[] }> {
  const detected = detectPlatforms(projectPath);
  const hasHarnessSignals =
    detected.length > 0 || hasSharedProjectResourceFiles(projectPath);
  const pluginSourceOnly = !hasHarnessSignals && isPluginSourcePath(projectPath);

  if (pluginSourceOnly) {
    const persisted = await scanAndPersistPluginSource(projectPath);
    const resourceIds = persisted.resources.map((resource) => resource.id);
    maybeUpsertProject(projectPath);
    return { kind: "scan", totalImports: resourceIds.length, resourceIds };
  }

  if (!hasHarnessSignals && !isPluginSourcePath(projectPath)) {
    return { kind: "scan", totalImports: 0, resourceIds: [] };
  }

  const merged = await persistMergedProjectScan(projectPath, undefined, {
    conflictPolicy,
    namespace: "",
    originRef: projectPath,
  });
  if (merged.harness.conflicts.length > 0) {
    throw Object.assign(
      new Error(`${merged.harness.conflicts.length} resource conflict(s)`),
      { code: "resource_conflict" },
    );
  }
  const resourceIds = merged.resources.map((resource) => resource.id);
  maybeUpsertProject(projectPath);
  return { kind: "scan", totalImports: resourceIds.length, resourceIds };
}

async function commitAdd(source: string): Promise<{
  kind: "add";
  totalImports: number;
  resourceIds: string[];
  namespace: string;
  snapshotId: string;
}> {
  const resolved = resolveSkillPackageCheckout(source, getHarnesstapDir());
  const imported = await importSkillPackage({
    rootPath: resolved.checkoutRoot,
    sourceLabel: resolved.namespace,
    gitUrl: resolved.gitUrl,
    gitSha: resolved.gitSha,
  });
  return {
    kind: "add",
    totalImports: imported.resources.length,
    resourceIds: imported.resources.map((resource) => resource.id),
    namespace: resolved.namespace,
    snapshotId: imported.snapshot.id,
  };
}

function maybeUpsertProject(projectRoot: string): void {
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    return;
  }
  upsertProject({
    git_origin: normalizeGitUrl(gitOrigin),
    name: projectNameFromUrl(gitOrigin),
    local_path: projectRoot,
  });
}
