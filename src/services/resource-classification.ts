export const CONTEXT_SIDE_RESOURCE_TYPES = [
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "hook",
  "agent",
  "command",
] as const;

/** @deprecated Use CONTEXT_SIDE_RESOURCE_TYPES */
export const PLUGIN_RESOURCE_TYPES = CONTEXT_SIDE_RESOURCE_TYPES;

export const ENVIRONMENT_RESOURCE_TYPES = [
  "env_var",
  "model_config",
  "permission",
] as const;

export type ContextSideResourceType = (typeof CONTEXT_SIDE_RESOURCE_TYPES)[number];
export type EnvironmentResourceType = (typeof ENVIRONMENT_RESOURCE_TYPES)[number];

/** @deprecated Use ContextSideResourceType */
export type PluginResourceType = ContextSideResourceType;
