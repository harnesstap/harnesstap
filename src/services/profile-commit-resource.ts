import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findResourceByKey,
  upsertResource,
} from "../models/resource.js";
import {
  addResourceToPlugin,
  removeResourceFromPlugin,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import { isProfilePlugin } from "../constants/profile.js";
import type { Resource, ResourceType } from "../types.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { markPluginDirty } from "./plugin-versioning.js";
import { collectProfilePluginIds } from "./profile-apply.js";
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
  const profilePlugin = resolvePluginSelector(profileSelector);
  if (!profilePlugin || !isProfilePlugin(profilePlugin)) {
    return null;
  }
  const merged = mergePluginsForApply(collectProfilePluginIds(profilePlugin));
  return (
    merged.resources.find(
      (resource) =>
        resource.type === resourceType && resource.name === resourceName,
    ) ?? null
  );
}

type ManagedDirKind = "skills" | "agents" | "commands" | "rules";

interface ManagedDirPrefix {
  prefix: string;
  kind: ManagedDirKind;
}

const SKILL_REMAINDER = /^([^/]+)\/SKILL\.md$/i;
const MARKDOWN_REMAINDER = /^([^/]+)\.md$/i;
const RULE_REMAINDER = /^([^/]+)\.(md|mdc)$/i;

function toManagedDirPrefix(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const stripped = raw.replace(/^~\//, "");
  if (!stripped.endsWith("/")) {
    return null;
  }
  return stripped;
}

function collectManagedDirPrefixes(): ManagedDirPrefix[] {
  const seen = new Set<string>();
  const entries: ManagedDirPrefix[] = [];

  const add = (raw: string | undefined, kind: ManagedDirKind) => {
    const prefix = toManagedDirPrefix(raw);
    if (!prefix) {
      return;
    }
    const key = `${kind}:${prefix.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({ prefix, kind });
  };

  for (const platform of getAllPlatforms()) {
    for (const paths of [platform.projectPaths, platform.globalPaths]) {
      add(paths.skills, "skills");
      add(paths.agents, "agents");
      add(paths.commands, "commands");
      add(paths.rules, "rules");
      for (const alternate of paths.pathAlternates?.skills ?? []) {
        add(alternate, "skills");
      }
      for (const alternate of paths.pathAlternates?.commands ?? []) {
        add(alternate, "commands");
      }
      for (const alternate of paths.pathAlternates?.rules ?? []) {
        add(alternate, "rules");
      }
    }
  }

  return entries.sort((left, right) => right.prefix.length - left.prefix.length);
}

const MANAGED_DIR_PREFIXES = collectManagedDirPrefixes();

function remainderAfterManagedDir(
  normalized: string,
  prefix: string,
): string | null {
  const lower = normalized.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower.startsWith(prefixLower)) {
    return normalized.slice(prefix.length);
  }
  const embedded = `/${prefixLower}`;
  const index = lower.indexOf(embedded);
  if (index === -1) {
    return null;
  }
  return normalized.slice(index + embedded.length);
}

function resourceKeyFromDirRemainder(
  kind: ManagedDirKind,
  remainder: string,
): { type: string; name: string } | null {
  switch (kind) {
    case "skills": {
      const match = remainder.match(SKILL_REMAINDER);
      return match?.[1] ? { type: "skill", name: match[1] } : null;
    }
    case "agents": {
      const match = remainder.match(MARKDOWN_REMAINDER);
      return match?.[1] ? { type: "agent", name: match[1] } : null;
    }
    case "commands": {
      const match = remainder.match(MARKDOWN_REMAINDER);
      return match?.[1] ? { type: "command", name: match[1] } : null;
    }
    case "rules": {
      const match = remainder.match(RULE_REMAINDER);
      return match?.[1] ? { type: "rule", name: match[1] } : null;
    }
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

/**
 * Map a managed harness path to a material resource identity when the mapping is 1:1.
 * Directory prefixes come from the platform registry so every harness groups together.
 */
export function resourceKeyFromManagedPath(
  path: string,
  rootPath?: string,
): { type: string; name: string } | null {
  const normalized = normalizeManagedPath(path, rootPath);
  for (const { prefix, kind } of MANAGED_DIR_PREFIXES) {
    const remainder = remainderAfterManagedDir(normalized, prefix);
    if (!remainder) {
      continue;
    }
    const mapped = resourceKeyFromDirRemainder(kind, remainder);
    if (mapped) {
      return mapped;
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
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
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

    markPluginDirty(profilePlugin.id);
    for (const resource of persisted.resolved) {
      if (resource.type !== "mcp_server") {
        continue;
      }
      liveNames.add(resource.name);
      if (!profileHasResource(input.profileSelector, resource.type, resource.name)) {
        addResourceToPlugin(profilePlugin.id, resource.id);
      }
      committed.push(toContentsResource(resource));
    }
  }

  // Live file is source of truth for this path: drop profile MCP servers that
  // were bound to this path but are no longer on disk.
  const merged = mergePluginsForApply(collectProfilePluginIds(profilePlugin));
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
      markPluginDirty(profilePlugin.id);
      removedAny = true;
    }
    removeResourceFromPlugin(profilePlugin.id, resource.id);
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
  const profilePlugin = resolvePluginSelector(input.profileSelector);
  if (!profilePlugin) {
    throw new Error(`Profile not found: ${input.profileSelector}`);
  }
  if (!isProfilePlugin(profilePlugin)) {
    throw new Error(`Plugin "${profilePlugin.name}" is not tagged as a profile`);
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
      markPluginDirty(profilePlugin.id);
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

  markPluginDirty(profilePlugin.id);
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
