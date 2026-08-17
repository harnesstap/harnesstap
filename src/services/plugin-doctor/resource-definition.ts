import type { Resource, ResourceType } from "../../types.js";

const PERMISSION_ACTIONS = new Set(["allow", "deny", "ask"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function metadataField(resource: Pick<Resource, "metadata">, key: string): unknown {
  return (resource.metadata as Record<string, unknown>)[key];
}

export function isResourceDefinitionEmpty(
  resource: Pick<Resource, "type" | "content" | "metadata">,
): boolean {
  switch (resource.type) {
    case "mcp_server":
      return !isNonEmptyString(metadataField(resource, "command"))
        && !isNonEmptyString(metadataField(resource, "url"));
    case "permission": {
      const action = metadataField(resource, "action");
      return typeof action !== "string"
        || !PERMISSION_ACTIONS.has(action)
        || !isNonEmptyString(metadataField(resource, "pattern"));
    }
    case "env_var":
      return !isNonEmptyString(metadataField(resource, "key"))
        || typeof metadataField(resource, "value") !== "string";
    case "model_config":
      return !isNonEmptyString(metadataField(resource, "model"));
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
