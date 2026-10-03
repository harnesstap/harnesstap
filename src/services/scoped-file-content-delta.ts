import { fileDiffHasContentChange } from "../utils/unified-diff.js";
import {
  hostConfigResourcesFromContent,
  scopeHostConfigToResource,
} from "./host-config-resource-detail.js";
import {
  mcpServerNamesFromConfig,
  scopeMcpConfigToServer,
} from "./mcp-resource-detail.js";
import {
  isClaudeSettingsPath,
  isClaudeUserJsonPath,
  isMuseSettingsPath,
} from "./merged-host-config.js";
import {
  isMcpConfigManagedPath,
  resourceKeyFromManagedPath,
} from "./profile-commit-resource.js";
import type { DriftFileChange } from "./project-drift.js";

export interface ManagedFileResourceIdentity {
  type: string;
  name: string;
}

function resourceKey(resource: ManagedFileResourceIdentity): string {
  return `${resource.type}:${resource.name}`;
}

function collectIdentities(
  path: string,
  contents: Array<string | null>,
): ManagedFileResourceIdentity[] {
  const order: ManagedFileResourceIdentity[] = [];
  const seen = new Set<string>();
  const add = (resource: ManagedFileResourceIdentity) => {
    const key = resourceKey(resource);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    order.push(resource);
  };

  const mapped = resourceKeyFromManagedPath(path);
  if (mapped) {
    add(mapped);
  }

  const inspectMcp =
    isMcpConfigManagedPath(path) || isClaudeUserJsonPath(path);
  const inspectHost = isClaudeSettingsPath(path) || isMuseSettingsPath(path);

  for (const content of contents) {
    if (!content) {
      continue;
    }
    if (inspectMcp) {
      for (const name of mcpServerNamesFromConfig(content)) {
        add({ type: "mcp_server", name });
      }
    }
    if (inspectHost) {
      for (const resource of hostConfigResourcesFromContent(content)) {
        add(resource);
      }
    }
  }
  return order;
}

function scopedBodies(
  expected: string,
  current: string | null,
  resource: ManagedFileResourceIdentity,
): { expected: string; current: string | null } {
  if (resource.type === "mcp_server") {
    return {
      expected: scopeMcpConfigToServer(expected, resource.name) ?? expected,
      current: scopeMcpConfigToServer(current, resource.name),
    };
  }
  if (
    resource.type === "permission"
    || resource.type === "hook"
    || resource.type === "env_var"
  ) {
    return {
      expected: scopeHostConfigToResource(expected, resource) ?? expected,
      current: scopeHostConfigToResource(current, resource),
    };
  }
  return { expected, current };
}

function scopedContentsDiffer(
  path: string,
  expected: string,
  current: string | null,
  resource: ManagedFileResourceIdentity,
): boolean {
  const scoped = scopedBodies(expected, current, resource);
  if (scoped.current === null) {
    return true;
  }
  return fileDiffHasContentChange(path, scoped.current, scoped.expected);
}

/** Resource identities in a shared config whose scoped live vs expected content differs. */
export function affectedResourcesForManagedFileDiff(input: {
  path: string;
  expected: string;
  current: string | null;
}): ManagedFileResourceIdentity[] {
  const identities = collectIdentities(input.path, [input.expected, input.current]);
  const affected = identities.filter((resource) =>
    scopedContentsDiffer(input.path, input.expected, input.current, resource),
  );
  return affected.sort((left, right) => {
    const typeOrder = left.type.localeCompare(right.type);
    return typeOrder !== 0 ? typeOrder : left.name.localeCompare(right.name);
  });
}

export function withAffectedResources(
  change: DriftFileChange,
  expected: string,
  current: string | null,
): DriftFileChange {
  const affected_resources = affectedResourcesForManagedFileDiff({
    path: change.path,
    expected,
    current,
  });
  return { ...change, affected_resources };
}
