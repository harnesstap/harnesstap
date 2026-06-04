export const PLUGIN_RESOURCE_TYPES = [
  "instruction",
  "skill",
  "rule",
  "mcp_server",
  "hook",
  "agent",
  "command",
] as const;

export const ENVIRONMENT_RESOURCE_TYPES = [
  "env_var",
  "model_config",
  "permission",
] as const;

export type PluginResourceType = (typeof PLUGIN_RESOURCE_TYPES)[number];
export type EnvironmentResourceType = (typeof ENVIRONMENT_RESOURCE_TYPES)[number];
