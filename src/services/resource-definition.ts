import type {
  EnvVarMetadata,
  McpServerMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
  Resource,
  ResourceType,
} from "../types.js";

const PERMISSION_ACTIONS = new Set<PermissionMetadata["action"]>([
  "allow",
  "deny",
  "ask",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isResourceDefinitionEmpty(
  resource: Pick<Resource, "type" | "content" | "metadata">,
): boolean {
  switch (resource.type) {
    case "mcp_server": {
      const metadata = resource.metadata as McpServerMetadata;
      if (metadata.transport === "http" || isNonEmptyString(metadata.url)) {
        return !isNonEmptyString(metadata.url);
      }
      return !isNonEmptyString(metadata.command);
    }
    case "permission": {
      const metadata = resource.metadata as PermissionMetadata;
      return !PERMISSION_ACTIONS.has(metadata.action)
        || !isNonEmptyString(metadata.pattern);
    }
    case "env_var": {
      const metadata = resource.metadata as EnvVarMetadata;
      return !isNonEmptyString(metadata.key) || typeof metadata.value !== "string";
    }
    case "model_config": {
      const metadata = resource.metadata as ModelConfigMetadata;
      return !isNonEmptyString(metadata.model);
    }
    case "instruction":
    case "skill":
    case "rule":
    case "agent":
    case "command":
    case "hook":
    case "plugin":
      return !resource.content.trim();
    default: {
      const _exhaustive: never = resource.type;
      return _exhaustive;
    }
  }
}

export function emptyDefinitionMessage(type: ResourceType, name: string): string {
  return `Resource has empty definition: ${type}:${name}`;
}
