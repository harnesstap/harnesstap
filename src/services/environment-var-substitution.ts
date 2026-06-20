import type { McpServerMetadata, Resource } from "../types.js";

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
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key]!;
    }
    missing.add(key);
    return match;
  });
  return { value, missing: uniqueSorted(missing) };
}

function substituteMcpServerMetadata(
  metadata: McpServerMetadata,
  vars: Record<string, string>,
): { metadata: McpServerMetadata; missing: string[] } {
  const missing = new Set<string>();

  let command = metadata.command;
  if (command !== undefined) {
    const substituted = substituteEnvironmentVars(command, vars);
    command = substituted.value;
    for (const key of substituted.missing) {
      missing.add(key);
    }
  }

  let args = metadata.args;
  if (args !== undefined) {
    args = args.map((arg) => {
      const substituted = substituteEnvironmentVars(arg, vars);
      for (const key of substituted.missing) {
        missing.add(key);
      }
      return substituted.value;
    });
  }

  let env = metadata.env;
  if (env !== undefined) {
    env = Object.fromEntries(
      Object.entries(env).map(([envKey, envValue]) => {
        const substituted = substituteEnvironmentVars(envValue, vars);
        for (const key of substituted.missing) {
          missing.add(key);
        }
        return [envKey, substituted.value];
      }),
    );
  }

  return {
    metadata: {
      ...metadata,
      ...(command !== undefined ? { command } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
    },
    missing: uniqueSorted(missing),
  };
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
