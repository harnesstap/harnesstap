import { findResourceByKey, getResource } from "../models/resource.js";
import type { Resource, ResourceType } from "../types.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import {
  mcpConfigContentsEquivalent,
  parseMcpServersDocument,
} from "./mcp-config-bridge.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import { hostPluginPinIsInstalled, listHostNativeMcpNames } from "./host-native-mcp.js";
import {
  isMcpConfigManagedPath,
  resourceKeyFromManagedPath,
} from "./profile-commit-resource.js";
import type { DriftFileChange } from "./project-drift.js";

const MATERIAL_TYPE_SET = new Set<string>(MATERIAL_RESOURCE_TYPES);

export interface OwnedPreviewResource {
  type: string;
  name: string;
}

function findMaterialResource(type: string, name: string): Resource | undefined {
  if (!MATERIAL_TYPE_SET.has(type)) {
    return undefined;
  }
  return (
    getResource(`${type}:${name}`)
    ?? findResourceByKey(type as ResourceType, name, "")
  );
}

function nativeMcpNamesForPath(homeRoot: string, path: string): Set<string> {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes(".cursor/") && /(^|\/)mcp\.json$/i.test(normalized)) {
    return listHostNativeMcpNames(homeRoot, "cursor");
  }
  if (/(^|\/)\.mcp\.json$/i.test(normalized)) {
    return listHostNativeMcpNames(homeRoot, "claude-code");
  }
  return new Set();
}

/**
 * Treat host-native plugin MCP servers as already present when comparing
 * expected vs live MCP config for apply preview.
 */
export function mcpPreviewContentsEquivalent(
  current: string | null,
  expected: string,
  nativeNames: ReadonlySet<string>,
): boolean {
  let expectedDocument: unknown;
  try {
    expectedDocument = JSON.parse(expected) as unknown;
  } catch {
    return false;
  }
  const expectedServers = parseMcpServersDocument(expectedDocument);
  const expectedNames = Object.keys(expectedServers);
  const nonNativeExpected = expectedNames.filter((name) => !nativeNames.has(name));

  if (current === null) {
    return expectedNames.length === 0 || nonNativeExpected.length === 0;
  }

  let currentDocument: unknown;
  try {
    currentDocument = JSON.parse(current) as unknown;
  } catch {
    return false;
  }
  const currentServers = parseMcpServersDocument(currentDocument);
  const mergedCurrent: Record<string, (typeof expectedServers)[string]> = {
    ...currentServers,
  };
  for (const name of expectedNames) {
    const expectedMeta = expectedServers[name];
    if (nativeNames.has(name) && expectedMeta && !(name in mergedCurrent)) {
      mergedCurrent[name] = expectedMeta;
    }
  }

  return mcpConfigContentsEquivalent(
    JSON.stringify({ mcpServers: mergedCurrent }),
    JSON.stringify({ mcpServers: expectedServers }),
  );
}

export function collectOwnedPreviewResources(
  expectedFiles: Array<{ path: string; content: string }>,
): OwnedPreviewResource[] {
  const order: string[] = [];
  const byKey = new Map<string, OwnedPreviewResource>();
  const add = (type: string, name: string) => {
    const key = `${type}:${name}`;
    if (byKey.has(key)) {
      return;
    }
    order.push(key);
    byKey.set(key, { type, name });
  };

  for (const file of expectedFiles) {
    const mapped = resourceKeyFromManagedPath(file.path);
    if (mapped) {
      add(mapped.type, mapped.name);
    }
    if (!isMcpConfigManagedPath(file.path)) {
      continue;
    }
    try {
      const document = JSON.parse(file.content) as unknown;
      for (const name of Object.keys(parseMcpServersDocument(document))) {
        add("mcp_server", name);
      }
    } catch {
      // skip invalid MCP payloads
    }
  }

  return order
    .map((key) => byKey.get(key))
    .filter((entry): entry is OwnedPreviewResource => entry !== undefined);
}

function resourceIsDeployedHostPluginOwned(
  type: string,
  name: string,
  homeRoot: string,
): { originRef: string; installed: boolean } | null {
  const resource = findMaterialResource(type, name);
  if (
    !resource
    || resource.origin_kind !== "marketplace_link"
    || !resource.origin_ref
  ) {
    return null;
  }
  return {
    originRef: resource.origin_ref,
    installed: hostPluginPinIsInstalled(homeRoot, resource.origin_ref),
  };
}

/**
 * Drop stack/file preview noise for resources already deployed by an installed
 * host plugin (marketplace pin). MCP config paths are handled separately.
 */
export function omitInheritedPluginFileChanges(
  homeRoot: string,
  changes: DriftFileChange[],
  targetPinRefs: ReadonlySet<string>,
): DriftFileChange[] {
  return changes.filter((change) => {
    if (isMcpConfigManagedPath(change.path)) {
      return true;
    }
    const mapped = change.resource ?? resourceKeyFromManagedPath(change.path);
    if (!mapped || mapped.type === "mcp_server") {
      return true;
    }
    const owned = resourceIsDeployedHostPluginOwned(
      mapped.type,
      mapped.name,
      homeRoot,
    );
    if (!owned?.installed) {
      return true;
    }
    switch (change.type) {
      case "deleted":
      case "modified":
        return false;
      case "added":
        return !targetPinRefs.has(owned.originRef);
      default: {
        const neverType: never = change.type;
        return neverType;
      }
    }
  });
}

export function expectedFileMatchesLiveForPreview(
  homeRoot: string,
  file: { path: string; content: string },
  current: string | null,
): boolean {
  if (isMcpConfigManagedPath(file.path)) {
    const nativeNames = nativeMcpNamesForPath(homeRoot, file.path);
    if (nativeNames.size > 0) {
      return mcpPreviewContentsEquivalent(current, file.content, nativeNames);
    }
  }
  if (current === null) {
    return false;
  }
  return fileContentsEquivalentForDrift(file.path, current, file.content);
}
