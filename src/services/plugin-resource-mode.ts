export const PLUGIN_RESOURCE_MODES = ["symlink", "copy", "clone"] as const;

export type PluginResourceMode = (typeof PLUGIN_RESOURCE_MODES)[number];

export const DEFAULT_PLUGIN_RESOURCE_MODE: PluginResourceMode = "symlink";

export function isPluginResourceMode(value: unknown): value is PluginResourceMode {
  return value === "symlink" || value === "copy" || value === "clone";
}

export function parsePluginResourceMode(
  value: string | undefined,
): PluginResourceMode {
  if (isPluginResourceMode(value)) return value;
  throw new Error(
    `Invalid plugin resource mode: ${value}. Use symlink, copy, or clone.`,
  );
}
