import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getPlatformIds } from "../platforms/registry.js";
import { getProject, listProjects } from "../models/project.js";
import {
  formatResourceSelector,
  getResource,
} from "../models/resource.js";
import { listResourceMaterializations } from "../models/resource-materialization.js";
import type {
  MaterializationAction,
  Resource,
  ResourceCreateInput,
  ResourceDeleteLocation,
  ResourceDeletePlan,
  ResourceDeleteResult,
  ResourceMaterialization,
} from "../types.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import { hashGeneratedContent } from "./materialization-ownership.js";
import { detectPlatforms, scanPlatform } from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";

interface Candidate {
  scope: ResourceDeleteLocation["scope"];
  project_id: string | null;
  project_name: string | null;
  root_path: string;
  /** Absolute path on disk. */
  path: string;
  /** Relative path under root when available. */
  relative_path: string | null;
  action: MaterializationAction;
  ownership_key: string;
  generated_hash: string;
  managed_container: boolean;
  platform_id: string | null;
  from_ledger: boolean;
}

function ownershipKeyFor(resource: Pick<Resource, "type" | "name" | "namespace">): string {
  return formatResourceSelector(resource, { includeType: true });
}

function matchesResource(
  discovered: ResourceCreateInput,
  resource: Resource,
): boolean {
  if (discovered.type !== resource.type) return false;
  if (discovered.name !== resource.name) return false;
  if ((discovered.namespace ?? "") !== resource.namespace) return false;
  if (
    resource.content_hash &&
    discovered.content_hash &&
    discovered.content_hash !== resource.content_hash
  ) {
    return false;
  }
  return true;
}

function isPathInsideRoot(rootPath: string, absolutePath: string): boolean {
  const resolvedRoot = resolve(rootPath);
  const resolvedPath = resolve(absolutePath);
  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(`${resolvedRoot}${sep}`)
  );
}

function assertSafeAbsolutePath(rootPath: string, absolutePath: string): string {
  if (!isPathInsideRoot(rootPath, absolutePath)) {
    throw new Error(`Path escapes root: ${absolutePath}`);
  }

  const resolvedRoot = existsSync(rootPath)
    ? realpathSync(rootPath)
    : resolve(rootPath);
  const fullPath = resolve(absolutePath);

  if (existsSync(fullPath)) {
    const resolvedTarget = realpathSync(fullPath);
    if (
      resolvedTarget !== resolvedRoot &&
      !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
    ) {
      throw new Error(`Path escapes root via symlink: ${absolutePath}`);
    }
  }

  let probePath = dirname(fullPath);
  while (!existsSync(probePath)) {
    const parentPath = dirname(probePath);
    if (parentPath === probePath) {
      throw new Error(`Path escapes root: ${absolutePath}`);
    }
    probePath = parentPath;
  }

  const resolvedProbe = realpathSync(probePath);
  if (
    resolvedProbe !== resolvedRoot &&
    !resolvedProbe.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`Path escapes root via symlink: ${absolutePath}`);
  }

  return fullPath;
}

function toAbsoluteUnderRoot(rootPath: string, pathValue: string): string {
  if (isAbsolute(pathValue)) {
    return resolve(pathValue);
  }
  return resolve(rootPath, pathValue);
}

function relativeUnderRoot(rootPath: string, absolutePath: string): string | null {
  const rel = relative(resolve(rootPath), resolve(absolutePath));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return rel;
}

function inferActionFromPath(
  absolutePath: string,
  resource: Resource,
): MaterializationAction {
  if (resource.type === "skill" && absolutePath.endsWith(`${sep}SKILL.md`)) {
    return "delete-directory";
  }
  if (absolutePath.endsWith("mcp.json") || absolutePath.endsWith("hooks.json")) {
    return "edit-file";
  }
  return "delete-file";
}

function candidateKey(candidate: Candidate): string {
  return resolve(candidate.path);
}

function upsertCandidate(
  map: Map<string, Candidate>,
  candidate: Candidate,
): void {
  const key = candidateKey(candidate);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  // Prefer ledger rows over discovery/source.
  if (candidate.from_ledger && !existing.from_ledger) {
    map.set(key, candidate);
    return;
  }
  if (existing.from_ledger && !candidate.from_ledger) {
    return;
  }
  // Prefer more specific non-source scopes when both are discovery.
  if (existing.scope === "source" && candidate.scope !== "source") {
    map.set(key, candidate);
  }
}

function collectLedgerCandidates(
  resource: Resource,
  map: Map<string, Candidate>,
): void {
  for (const row of listResourceMaterializations(resource.id)) {
    const absolute = toAbsoluteUnderRoot(row.root_path, row.path);
    const project = row.project_id ? getProject(row.project_id) : undefined;
    upsertCandidate(map, {
      scope: row.scope,
      project_id: row.project_id,
      project_name: project?.name ?? null,
      root_path: row.root_path,
      path: absolute,
      relative_path: isAbsolute(row.path)
        ? relativeUnderRoot(row.root_path, absolute)
        : row.path,
      action: row.action,
      ownership_key: row.ownership_key,
      generated_hash: row.generated_hash,
      managed_container: row.managed_container,
      platform_id: row.platform_id,
      from_ledger: true,
    });
  }
}

function collectSourceCandidates(
  resource: Resource,
  map: Map<string, Candidate>,
): void {
  const ownershipKey = ownershipKeyFor(resource);
  for (const raw of [resource.source, resource.origin_ref]) {
    if (!raw || raw === "manual") continue;
    const absolute = resolve(raw);
    if (!existsSync(absolute)) continue;
    const rootPath = dirname(absolute);
    upsertCandidate(map, {
      scope: "source",
      project_id: null,
      project_name: null,
      root_path: rootPath,
      path: absolute,
      relative_path: relativeUnderRoot(rootPath, absolute),
      action: inferActionFromPath(absolute, resource),
      ownership_key: ownershipKey,
      generated_hash: "",
      managed_container: false,
      platform_id: null,
      from_ledger: false,
    });
  }
}

async function collectDiscoveryCandidates(
  resource: Resource,
  map: Map<string, Candidate>,
): Promise<void> {
  const ownershipKey = ownershipKeyFor(resource);
  const homeRoot = resolveHomeRoot();

  for (const platformId of getPlatformIds()) {
    const serializer = getPlatformSerializer(platformId);
    const discovered = serializer.scanGlobal
      ? await serializer.scanGlobal(homeRoot)
      : [];
    for (const entry of discovered) {
      if (!matchesResource(entry, resource)) continue;
      if (!entry.source || entry.source === "manual") continue;
      const absolute = toAbsoluteUnderRoot(homeRoot, entry.source);
      if (!existsSync(absolute)) continue;
      upsertCandidate(map, {
        scope: "global",
        project_id: null,
        project_name: null,
        root_path: homeRoot,
        path: absolute,
        relative_path: relativeUnderRoot(homeRoot, absolute),
        action: inferActionFromPath(absolute, resource),
        ownership_key: ownershipKey,
        generated_hash: "",
        managed_container: false,
        platform_id: platformId,
        from_ledger: false,
      });
    }
  }

  for (const project of listProjects()) {
    if (!project.local_path || !existsSync(project.local_path)) continue;
    const platforms = detectPlatforms(project.local_path);
    for (const platformId of platforms) {
      const scan = await scanPlatform(platformId, project.local_path);
      for (const entry of scan.resources) {
        if (!matchesResource(entry, resource)) continue;
        if (!entry.source || entry.source === "manual") continue;
        const absolute = toAbsoluteUnderRoot(project.local_path, entry.source);
        if (!existsSync(absolute)) continue;
        upsertCandidate(map, {
          scope: "project",
          project_id: project.id,
          project_name: project.name,
          root_path: project.local_path,
          path: absolute,
          relative_path: relativeUnderRoot(project.local_path, absolute),
          action: inferActionFromPath(absolute, resource),
          ownership_key: ownershipKey,
          generated_hash: "",
          managed_container: false,
          platform_id: platformId,
          from_ledger: false,
        });
      }
    }
  }
}

function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    if (!lstatSync(path).isFile()) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function tryEditAggregateContent(
  content: string,
  resource: Resource,
): { ok: true; content: string; emptied: boolean } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "Shared file section cannot be identified" };
    }
    const obj = parsed as Record<string, unknown>;

    // Cursor/Claude-style MCP: { mcpServers: { name: ... } }
    if (
      obj.mcpServers &&
      typeof obj.mcpServers === "object" &&
      !Array.isArray(obj.mcpServers)
    ) {
      const servers = { ...(obj.mcpServers as Record<string, unknown>) };
      if (!(resource.name in servers)) {
        return { ok: false, reason: "Shared file section cannot be identified" };
      }
      delete servers[resource.name];
      const next = { ...obj, mcpServers: servers };
      const emptied = Object.keys(servers).length === 0;
      return {
        ok: true,
        content: `${JSON.stringify(next, null, 2)}\n`,
        emptied,
      };
    }

    // Top-level keyed aggregate (some MCP layouts): { name: ... }
    if (resource.name in obj) {
      const next = { ...obj };
      delete next[resource.name];
      return {
        ok: true,
        content: `${JSON.stringify(next, null, 2)}\n`,
        emptied: Object.keys(next).length === 0,
      };
    }

    return { ok: false, reason: "Shared file section cannot be identified" };
  } catch {
    return { ok: false, reason: "Shared file section cannot be identified" };
  }
}

function evaluateCandidate(
  candidate: Candidate,
  resource: Resource,
): ResourceDeleteLocation {
  const base = {
    scope: candidate.scope,
    project_id: candidate.project_id,
    project_name: candidate.project_name,
    root_path: candidate.root_path,
    path: candidate.path,
    ownership_key: candidate.ownership_key,
  };

  try {
    assertSafeAbsolutePath(candidate.root_path, candidate.path);
  } catch {
    return {
      ...base,
      action: "protected",
      reason: "Path escapes declared root",
    };
  }

  // Never allow deleting the root itself or an arbitrary parent directory.
  if (
    candidate.action === "delete-directory" &&
    resolve(candidate.path) === resolve(candidate.root_path)
  ) {
    return {
      ...base,
      action: "protected",
      reason: "Refusing to delete root directory",
    };
  }

  if (!existsSync(candidate.path)) {
    return {
      ...base,
      action: "protected",
      reason: "Path no longer exists",
    };
  }

  if (candidate.action === "delete-file") {
    const content = readTextIfExists(candidate.path);
    if (content === null) {
      return {
        ...base,
        action: "protected",
        reason: "Modified file is protected",
      };
    }
    if (candidate.generated_hash) {
      const currentHash = hashGeneratedContent(content);
      if (currentHash !== candidate.generated_hash) {
        return {
          ...base,
          action: "protected",
          reason: "Modified file is protected",
        };
      }
    } else if (!candidate.from_ledger) {
      // Discovery/source without a recorded hash: only allow surgical edits of
      // known aggregate formats. Anything else is protected.
      if (
        candidate.path.endsWith("mcp.json") ||
        candidate.path.endsWith("hooks.json")
      ) {
        const edit = tryEditAggregateContent(content, resource);
        if (!edit.ok) {
          return {
            ...base,
            action: "protected",
            reason: edit.reason,
          };
        }
        return {
          ...base,
          action: "edit-file",
          reason: "Surgical edit of shared source file",
        };
      }
      return {
        ...base,
        action: "protected",
        reason: "Shared file section cannot be identified",
      };
    }
    return {
      ...base,
      action: "delete-file",
      reason: "Standalone file matches recorded content",
    };
  }

  if (candidate.action === "delete-directory") {
    const skillDir =
      candidate.path.endsWith(`${sep}SKILL.md`) ||
      candidate.path.endsWith("/SKILL.md")
        ? dirname(candidate.path)
        : candidate.path;
    if (!isPathInsideRoot(candidate.root_path, skillDir)) {
      return {
        ...base,
        action: "protected",
        reason: "Path escapes declared root",
      };
    }
    if (resolve(skillDir) === resolve(candidate.root_path)) {
      return {
        ...base,
        action: "protected",
        reason: "Refusing to delete root directory",
      };
    }
    if (candidate.generated_hash && existsSync(candidate.path)) {
      const content = readTextIfExists(candidate.path);
      if (content !== null) {
        const currentHash = hashGeneratedContent(content);
        if (currentHash !== candidate.generated_hash) {
          return {
            ...base,
            action: "protected",
            reason: "Modified file is protected",
          };
        }
      }
    }
    return {
      ...base,
      path: skillDir,
      action: "delete-directory",
      reason: "Owned skill directory",
    };
  }

  // edit-file
  const content = readTextIfExists(candidate.path);
  if (content === null) {
    return {
      ...base,
      action: "protected",
      reason: "Shared file section cannot be identified",
    };
  }
  const edit = tryEditAggregateContent(content, resource);
  if (!edit.ok) {
    return {
      ...base,
      action: "protected",
      reason: edit.reason,
    };
  }
  return {
    ...base,
    action: "edit-file",
    reason: "Surgical edit of shared aggregate file",
  };
}

export async function planResourceDiskDeletion(
  resourceId: string,
): Promise<ResourceDeletePlan> {
  const resource = getResource(resourceId);
  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  const map = new Map<string, Candidate>();
  collectLedgerCandidates(resource, map);
  collectSourceCandidates(resource, map);
  await collectDiscoveryCandidates(resource, map);

  const locations = [...map.values()]
    .map((candidate) => evaluateCandidate(candidate, resource))
    .sort((a, b) => a.path.localeCompare(b.path));

  const blockers = [
    ...new Set(
      locations
        .filter((location) => location.action === "protected")
        .map((location) => location.reason),
    ),
  ];

  return {
    resource: {
      id: resource.id,
      type: resource.type,
      name: resource.name,
      namespace: resource.namespace,
    },
    locations,
    blockers,
    can_delete_from_disk: blockers.length === 0 && locations.length > 0
      ? true
      : blockers.length === 0,
  };
}

function removeEmptyParents(startPath: string, stopAt: string): void {
  let current = startPath;
  const stop = resolve(stopAt);
  while (current !== stop) {
    const parent = dirname(current);
    if (parent === current) break;
    if (!existsSync(parent)) {
      current = parent;
      continue;
    }
    if (resolve(parent) === stop) break;
    try {
      if (readdirSync(parent).length === 0) {
        rmSync(parent, { recursive: true, force: true });
        current = parent;
        continue;
      }
    } catch {
      // best-effort
    }
    break;
  }
}

function writeViaTemp(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.ht-delete-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, path);
}

export async function executeResourceDiskDeletion(
  plan: ResourceDeletePlan,
): Promise<
  Pick<ResourceDeleteResult, "deleted_files" | "edited_files" | "skipped_locations">
> {
  if (!plan.can_delete_from_disk || plan.blockers.length > 0) {
    return {
      deleted_files: [],
      edited_files: [],
      skipped_locations: plan.locations.map((location) => location.path),
    };
  }

  const resource = getResource(plan.resource.id);
  if (!resource) {
    throw new Error(`Resource not found: ${plan.resource.id}`);
  }

  type Backup =
    | { kind: "file"; path: string; content: string; existed: true }
    | { kind: "file"; path: string; existed: false }
    | { kind: "directory"; path: string; entries: Map<string, string> };

  const backups: Backup[] = [];
  const deletedFiles: string[] = [];
  const editedFiles: string[] = [];

  const restore = (): void => {
    for (const backup of [...backups].reverse()) {
      if (backup.kind === "file") {
        if (!backup.existed) {
          rmSync(backup.path, { force: true });
          continue;
        }
        mkdirSync(dirname(backup.path), { recursive: true });
        writeFileSync(backup.path, backup.content, "utf-8");
        continue;
      }
      mkdirSync(backup.path, { recursive: true });
      for (const [rel, content] of backup.entries) {
        const full = join(backup.path, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, "utf-8");
      }
    }
  };

  try {
    for (const location of plan.locations) {
      assertSafeAbsolutePath(location.root_path, location.path);

      switch (location.action) {
        case "delete-file": {
          const existed = existsSync(location.path);
          if (existed) {
            backups.push({
              kind: "file",
              path: location.path,
              content: readFileSync(location.path, "utf-8"),
              existed: true,
            });
            rmSync(location.path, { force: true });
            removeEmptyParents(location.path, location.root_path);
          } else {
            backups.push({ kind: "file", path: location.path, existed: false });
          }
          deletedFiles.push(location.path);
          break;
        }
        case "delete-directory": {
          if (!existsSync(location.path)) {
            deletedFiles.push(location.path);
            break;
          }
          const entries = new Map<string, string>();
          const walk = (dir: string, prefix = ""): void => {
            for (const name of readdirSync(dir)) {
              const full = join(dir, name);
              const rel = prefix ? join(prefix, name) : name;
              if (lstatSync(full).isDirectory()) {
                walk(full, rel);
              } else {
                entries.set(rel, readFileSync(full, "utf-8"));
              }
            }
          };
          walk(location.path);
          backups.push({ kind: "directory", path: location.path, entries });
          rmSync(location.path, { recursive: true, force: true });
          removeEmptyParents(location.path, location.root_path);
          deletedFiles.push(location.path);
          break;
        }
        case "edit-file": {
          const content = readFileSync(location.path, "utf-8");
          backups.push({
            kind: "file",
            path: location.path,
            content,
            existed: true,
          });
          const edit = tryEditAggregateContent(content, resource);
          if (!edit.ok) {
            throw new Error(edit.reason);
          }
          if (edit.emptied) {
            rmSync(location.path, { force: true });
            removeEmptyParents(location.path, location.root_path);
            deletedFiles.push(location.path);
          } else {
            writeViaTemp(location.path, edit.content);
            editedFiles.push(location.path);
          }
          break;
        }
        case "protected": {
          throw new Error(`Refusing protected location: ${location.path}`);
        }
        default: {
          const _exhaustive: never = location.action;
          throw new Error(`Unsupported delete action: ${String(_exhaustive)}`);
        }
      }
    }
  } catch (error) {
    restore();
    throw error;
  }

  return {
    deleted_files: deletedFiles,
    edited_files: editedFiles,
    skipped_locations: [],
  };
}

/** @internal test helper re-export */
export type { ResourceMaterialization };
