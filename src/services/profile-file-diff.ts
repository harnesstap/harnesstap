import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  collectExpectedManagedFiles,
  type ProfileApplyPreviewScope,
} from "./profile-apply-preview.js";
import {
  isMcpConfigManagedPath,
  resourceKeyFromManagedPath,
} from "./profile-commit-resource.js";
import { scopeHostConfigToResource } from "./host-config-resource-detail.js";
import { scopeMcpConfigToServer } from "./mcp-resource-detail.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import { normalizeManagedPath } from "./profile-untracked-resources.js";

export interface ManagedFileDiff {
  path: string;
  absolute_path: string;
  /** Expected content from the profile (last applied / would-apply snapshot). */
  expected: string;
  /** Current on-disk content, or null if the file is missing. */
  current: string | null;
}

const ONE_TO_ONE_DIFF_TYPES = new Set(["skill", "agent", "command", "rule", "instruction"]);
const HOST_CONFIG_DIFF_TYPES = new Set(["permission", "hook", "env_var"]);

function readLiveFile(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    return readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

function namesEqualIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function pathsReferToSameManagedFile(
  left: string,
  right: string,
  rootPath: string,
): boolean {
  const a = normalizeManagedPath(left, rootPath);
  const b = normalizeManagedPath(right, rootPath);
  if (a === b) {
    return true;
  }
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function resolveLiveAbsolute(path: string, rootPath: string): string {
  const normalized = normalizeManagedPath(path, rootPath);
  if (isAbsolute(normalized)) {
    return normalized;
  }
  return join(rootPath, normalized);
}

function resourceMatchesFile(
  resource: { type: string; name: string },
  filePath: string,
  rootPath: string,
): boolean {
  const mapped = resourceKeyFromManagedPath(filePath, rootPath);
  return (
    mapped !== null
    && mapped.type === resource.type
    && namesEqualIgnoreCase(mapped.name, resource.name)
  );
}

function findExpectedManagedFile(input: {
  expectedFiles: Array<{ path: string; content: string }>;
  requestedPath: string;
  rootPath: string;
  resource?: { type: string; name: string };
}): { path: string; content: string } | undefined {
  const byPath = input.expectedFiles.find((file) =>
    pathsReferToSameManagedFile(file.path, input.requestedPath, input.rootPath),
  );
  const resource = input.resource;
  if (!resource?.type || !resource.name.trim()) {
    return byPath;
  }

  const byIdentity = input.expectedFiles.find((file) =>
    resourceMatchesFile(resource, file.path, input.rootPath),
  );

  if (ONE_TO_ONE_DIFF_TYPES.has(resource.type)) {
    return byIdentity ?? byPath;
  }

  if (resource.type === "mcp_server") {
    if (byPath && isMcpConfigManagedPath(byPath.path, input.rootPath)) {
      return byPath;
    }
    return (
      input.expectedFiles.find((file) =>
        isMcpConfigManagedPath(file.path, input.rootPath),
      )
      ?? byPath
    );
  }

  if (HOST_CONFIG_DIFF_TYPES.has(resource.type)) {
    if (byPath && isMergeableHostConfigPath(byPath.path)) {
      return byPath;
    }
    return (
      input.expectedFiles.find((file) => isMergeableHostConfigPath(file.path))
      ?? byPath
    );
  }

  return byIdentity ?? byPath;
}

function resolveCurrentAbsolute(input: {
  requestedPath: string;
  matchPath: string;
  rootPath: string;
  resource?: { type: string; name: string };
}): string {
  const matchAbs = join(
    input.rootPath,
    normalizeManagedPath(input.matchPath, input.rootPath),
  );
  const requestedAbs = resolveLiveAbsolute(input.requestedPath, input.rootPath);
  if (input.resource && ONE_TO_ONE_DIFF_TYPES.has(input.resource.type)) {
    return matchAbs;
  }
  if (existsSync(requestedAbs)) {
    return requestedAbs;
  }
  return matchAbs;
}

function applyResourceScope(input: {
  relativePath: string;
  rootPath: string;
  expected: string;
  current: string | null;
  resource?: { type: string; name: string };
}): { expected: string; current: string | null } {
  const resourceName = input.resource?.name.trim() ?? "";
  const resourceType = input.resource?.type ?? "";
  if (!resourceName || !resourceType) {
    return { expected: input.expected, current: input.current };
  }

  if (
    resourceType === "mcp_server"
    && isMcpConfigManagedPath(input.relativePath, input.rootPath)
  ) {
    return {
      expected: scopeMcpConfigToServer(input.expected, resourceName) ?? input.expected,
      current: scopeMcpConfigToServer(input.current, resourceName),
    };
  }

  if (
    HOST_CONFIG_DIFF_TYPES.has(resourceType)
    && isMergeableHostConfigPath(input.relativePath)
  ) {
    const resource = { type: resourceType, name: resourceName };
    return {
      expected: scopeHostConfigToResource(input.expected, resource) ?? input.expected,
      current: scopeHostConfigToResource(input.current, resource),
    };
  }

  return { expected: input.expected, current: input.current };
}

export async function getManagedFileDiff(input: {
  profileSelector: string;
  path: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
  resource?: { type: string; name: string };
}): Promise<ManagedFileDiff> {
  const profile = input.profileSelector.trim();
  const requestedPath = input.path.trim();

  const collected = await collectExpectedManagedFiles({
    profile,
    scope: input.scope,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  });

  if (collected.warning) {
    throw new Error(collected.warning);
  }

  const match = findExpectedManagedFile({
    expectedFiles: collected.expectedFiles,
    requestedPath,
    rootPath: collected.rootPath,
    ...(input.resource ? { resource: input.resource } : {}),
  });

  if (!match) {
    const liveAbsolute = resolveLiveAbsolute(requestedPath, collected.rootPath);
    if (
      input.resource?.type === "agent"
      && readLiveFile(liveAbsolute) !== null
    ) {
      const relativePath = normalizeManagedPath(liveAbsolute, collected.rootPath);
      const live = readLiveFile(liveAbsolute) ?? "";
      return {
        path: relativePath,
        absolute_path: liveAbsolute,
        expected: live,
        current: live,
      };
    }
    throw new Error(`Path is not a managed file for this profile: ${input.path}`);
  }

  const relativePath = normalizeManagedPath(match.path, collected.rootPath);
  const absolutePath = resolveCurrentAbsolute({
    requestedPath,
    matchPath: match.path,
    rootPath: collected.rootPath,
    ...(input.resource ? { resource: input.resource } : {}),
  });
  const scoped = applyResourceScope({
    relativePath,
    rootPath: collected.rootPath,
    expected: match.content,
    current: readLiveFile(absolutePath),
    ...(input.resource ? { resource: input.resource } : {}),
  });

  return {
    path: relativePath,
    absolute_path: absolutePath,
    expected: scoped.expected,
    current: scoped.current,
  };
}
