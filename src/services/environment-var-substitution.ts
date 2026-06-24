import type { McpServerMetadata, Resource } from "../types.js";
import { substituteMcpServerMetadata } from "./mcp-config-bridge.js";

const VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function substituteEnvironmentVars(
  template: string,
  vars: Record<string, string>,
): { value: string; missing: string[] } {
  const missing = new Set<string>();
  const value = template.replace(VAR_PATTERN, (match, key: string) => {
    if (Object.hasOwn(vars, key)) {
      const resolved = vars[key];
      if (resolved !== undefined) {
        return resolved;
      }
    }
    missing.add(key);
    return match;
  });
  return { value, missing: uniqueSorted(missing) };
}

export function collectEnvironmentVarPlaceholders(template: string): string[] {
  return substituteEnvironmentVars(template, {}).missing;
}

export function substituteResourceMetadata(
  resource: Pick<Resource, "type" | "metadata">,
  vars: Record<string, string>,
): { resource: Pick<Resource, "type" | "metadata">; missing: string[] } {
  switch (resource.type) {
    case "mcp_server": {
      const { metadata, missing } = substituteMcpServerMetadata(
        resource.metadata as McpServerMetadata,
        vars,
      );
      return {
        resource: { ...resource, metadata },
        missing,
      };
    }
    default:
      return { resource, missing: [] };
  }
}

export function substituteResourcesForApply(
  resources: Resource[],
  vars: Record<string, string>,
): { resources: Resource[]; missing: string[] } {
  const missing = new Set<string>();
  const substitutedResources = resources.map((resource) => {
    if (resource.type !== "mcp_server") {
      return resource;
    }

    const { resource: updated, missing: resourceMissing } = substituteResourceMetadata(
      resource,
      vars,
    );
    for (const key of resourceMissing) {
      missing.add(key);
    }
    return { ...resource, metadata: updated.metadata };
  });

  return {
    resources: substitutedResources,
    missing: uniqueSorted(missing),
  };
}
