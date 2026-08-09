import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findResourceByKey,
  upsertResource,
} from "../models/resource.js";
import {
  addResourceToLayer,
  removeResourceFromLayer,
  resolveLayerSelector,
} from "../models/layer-model.js";
import { isProfileLayer } from "../constants/profile.js";
import type { Resource, ResourceType } from "../types.js";
import { mergeLayersForApply } from "./layer-apply-merge.js";
import { markLayerDirty } from "./layer-versioning.js";
import { collectProfileLayerIds } from "./profile-apply.js";
import {
  toContentsResource,
  type ProfileContentsResource,
} from "./profile-contents.js";
import type { ProfileApplyPreviewScope } from "./profile-apply-preview.js";
import { resolveMainHarnessTarget } from "./profile-harness-sync.js";
import {
  persistScanResults,
  scanHomeDefaults,
  scanProject,
  type ScanResult,
} from "./scanner.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { sourceMatchesManagedPath } from "./mcp-target.js";
import { normalizeManagedPath } from "./profile-untracked-resources.js";

function profileHasResource(
  profileSelector: string,
  resourceType: string,
  resourceName: string,
): Resource | null {
  const profileLayer = resolveLayerSelector(profileSelector);
  if (!profileLayer || !isProfileLayer(profileLayer)) {
    return null;
  }
  const merged = mergeLayersForApply(collectProfileLayerIds(profileLayer));
  return (
    merged.resources.find(
      (resource) =>
        resource.type === resourceType && resource.name === resourceName,
    ) ?? null
  );
}

/**
 * Map a managed harness path to a material resource identity when the mapping is 1:1.
 */
export function resourceKeyFromManagedPath(
  path: string,
  rootPath?: string,
): { type: string; name: string } | null {
  const normalized = normalizeManagedPath(path, rootPath);
  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.cursor\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.copilot\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.agents\/skills\/([^/]+)\/SKILL\.md$/i, type: "skill" },
    { re: /(?:^|\/)\.claude\/rules\/([^/]+)\.md$/i, type: "rule" },
    { re: /(?:^|\/)\.cursor\/rules\/([^/]+)\.mdc$/i, type: "rule" },
    { re: /(?:^|\/)\.claude\/commands\/([^/]+)\.md$/i, type: "command" },
    { re: /(?:^|\/)\.cursor\/commands\/([^/]+)\.md$/i, type: "command" },
    { re: /(?:^|\/)\.claude\/agents\/([^/]+)\.md$/i, type: "agent" },
    { re: /(?:^|\/)\.cursor\/agents\/([^/]+)\.md$/i, type: "agent" },
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern.re);
    if (match?.[1]) {
      return { type: pattern.type, name: match[1] };
    }
  }
  return null;
}

/** Aggregate MCP config files (many mcp_server resources per path). */
export function isMcpConfigManagedPath(path: string, rootPath?: string): boolean {
  const normalized = normalizeManagedPath(path, rootPath);
  // Dedicated MCP JSON filenames used across harnesses.
  if (/(^|\/)(\.?mcp\.json|mcp[-_]config\.json)$/i.test(normalized)) {
    return true;
  }
  // Also accept any registry-declared MCP path (opencode.json, config.toml, …).
  const stripped = normalized.replace(/^~\//, "");
  for (const platform of getAllPlatforms()) {
    for (const candidate of [
      platform.projectPaths.mcp,
      platform.globalPaths.mcp,
    ]) {
      if (!candidate) {
        continue;
      }
      const candidateNorm = normalizeManagedPath(candidate).replace(/^~\//, "");
      if (stripped === candidateNorm) {
        return true;
      }
    }
  }
  return false;
}

async function scanForCommit(input: {
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ originRef: string; scanned: ScanResult[] }> {
  const originRef =
    input.scope === "project"
      ? resolve(input.projectPath ?? "")
      : resolveHomeRoot();
  if (input.scope === "project" && !input.projectPath) {
    throw new Error("projectPath is required for project scope");
  }
  const scanned =
    input.scope === "project"
      ? await scanProject(originRef)
      : await scanHomeDefaults(
          input.harness ? resolveMainHarnessTarget(input.harness) : undefined,
          originRef,
        );
  return { originRef, scanned };
}

async function commitMcpConfigFromLive(input: {
  profileSelector: string;
  path: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ProfileContentsResource[]> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }

  const { originRef, scanned } = await scanForCommit(input);
  const matching = scanned
    .map((result) => ({
      ...result,
      resources: result.resources.filter(
        (resource) =>
          resource.type === "mcp_server"
          && sourceMatchesManagedPath(resource.source, input.path, originRef),
      ),
    }))
    .filter((result) => result.resources.length > 0);

  const liveNames = new Set<string>();
  const committed: ProfileContentsResource[] = [];

  if (matching.length > 0) {
    const persisted = persistScanResults(matching, {
      conflictPolicy: "overwrite",
      originRef,
    });

    markLayerDirty(profileLayer.id);
    for (const resource of persisted.resolved) {
      if (resource.type !== "mcp_server") {
        continue;
      }
      liveNames.add(resource.name);
      if (!profileHasResource(input.profileSelector, resource.type, resource.name)) {
        addResourceToLayer(profileLayer.id, resource.id);
      }
      committed.push(toContentsResource(resource));
    }
  }

  // Live file is source of truth for this path: drop profile MCP servers that
  // were bound to this path but are no longer on disk.
  const merged = mergeLayersForApply(collectProfileLayerIds(profileLayer));
  let removedAny = false;
  for (const resource of merged.resources) {
    if (resource.type !== "mcp_server") {
      continue;
    }
    if (!sourceMatchesManagedPath(resource.source, input.path, originRef)) {
      continue;
    }
    if (liveNames.has(resource.name)) {
      continue;
    }
    if (!removedAny) {
      markLayerDirty(profileLayer.id);
      removedAny = true;
    }
    removeResourceFromLayer(profileLayer.id, resource.id);
  }

  if (matching.length === 0 && committed.length === 0) {
    // Empty live MCP file is a valid commit (clears path-owned servers).
    return [];
  }

  if (committed.length === 0 && matching.length > 0) {
    throw new Error(`Could not commit MCP servers from: ${input.path}`);
  }
  return committed;
}

/**
 * Snapshot live disk content into the library for a profile-managed resource.
 */
export async function commitManagedResourceFromLive(input: {
  profileSelector: string;
  resourceType: string;
  resourceName: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
  path?: string;
}): Promise<ProfileContentsResource> {
  const profileLayer = resolveLayerSelector(input.profileSelector);
  if (!profileLayer) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfileLayer(profileLayer)) {
    throw new Error(`Layer "${profileLayer.name}" is not tagged as a profile`);
  }

  let resourceType = input.resourceType;
  let resourceName = input.resourceName;
  if ((!resourceType || !resourceName) && input.path) {
    const mapped = resourceKeyFromManagedPath(input.path);
    if (!mapped) {
      throw new Error(
        `Cannot map path to a single resource for commit: ${input.path}`,
      );
    }
    resourceType = mapped.type;
    resourceName = mapped.name;
  }

  const attached = profileHasResource(
    input.profileSelector,
    resourceType,
    resourceName,
  );
  if (!attached) {
    throw new Error(
      `Resource is not in profile: ${resourceType}:${resourceName}`,
    );
  }

  const { originRef, scanned } = await scanForCommit(input);

  const matching = scanned
    .map((result) => ({
      ...result,
      resources: result.resources.filter(
        (resource) =>
          resource.type === resourceType && resource.name === resourceName,
      ),
    }))
    .filter((result) => result.resources.length > 0);

  if (matching.length === 0) {
    // Fall back: update from attached resource path if scan name differs (instructions).
    if (input.path && attached.type === "instruction") {
      const fullPath = join(originRef, normalizeManagedPath(input.path, originRef));
      if (!existsSync(fullPath)) {
        throw new Error(`Live file not found: ${input.path}`);
      }
      const content = readFileSync(fullPath, "utf-8");
      markLayerDirty(profileLayer.id);
      const updated = upsertResource(
        {
          type: attached.type,
          name: attached.name,
          namespace: attached.namespace,
          description: attached.description,
          content,
          metadata: attached.metadata,
          source: attached.source,
          origin_kind: "local_snapshot",
          origin_ref: attached.origin_ref || originRef,
        },
        { policy: "overwrite" },
      );
      if (updated.action === "skipped") {
        throw new Error(`Could not update resource: ${resourceType}:${resourceName}`);
      }
      return toContentsResource(updated.resource);
    }
    throw new Error(
      `Resource not found on disk: ${resourceType}:${resourceName}`,
    );
  }

  markLayerDirty(profileLayer.id);
  const persisted = persistScanResults(matching, {
    conflictPolicy: "overwrite",
    originRef,
  });
  const resource =
    persisted.resolved.find(
      (entry) => entry.type === resourceType && entry.name === resourceName,
    )
    ?? findResourceByKey(
      resourceType as ResourceType,
      resourceName,
      attached.namespace,
    );
  if (!resource) {
    throw new Error(
      `Could not commit resource: ${resourceType}:${resourceName}`,
    );
  }
  return toContentsResource(resource);
}

/**
 * Commit a managed path from live disk into the profile library.
 * Supports 1:1 material paths and aggregate MCP config files.
 */
export async function commitManagedPathFromLive(input: {
  profileSelector: string;
  path: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
  resourceType?: string;
  resourceName?: string;
}): Promise<ProfileContentsResource[]> {
  const mapped =
    input.resourceType && input.resourceName
      ? { type: input.resourceType, name: input.resourceName }
      : resourceKeyFromManagedPath(input.path);

  if (mapped) {
    const resource = await commitManagedResourceFromLive({
      profileSelector: input.profileSelector,
      resourceType: mapped.type,
      resourceName: mapped.name,
      scope: input.scope,
      path: input.path,
      ...(input.projectPath ? { projectPath: input.projectPath } : {}),
      ...(input.harness ? { harness: input.harness } : {}),
    });
    return [resource];
  }

  if (isMcpConfigManagedPath(input.path)) {
    return commitMcpConfigFromLive({
      profileSelector: input.profileSelector,
      path: input.path,
      scope: input.scope,
      ...(input.projectPath ? { projectPath: input.projectPath } : {}),
      ...(input.harness ? { harness: input.harness } : {}),
    });
  }

  throw new Error(`Cannot map path to a resource for commit: ${input.path}`);
}
