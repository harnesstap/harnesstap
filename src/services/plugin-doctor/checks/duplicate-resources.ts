import type { Resource } from "../../../types.js";
import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";

export const duplicateResourcesCheck = {
  id: "duplicate-resources",
  description: "Detect duplicate resource type/name entries in a plugin",
  run({ resources }: PluginDoctorContext): PluginDoctorCheckResult[] {
    const resourcesByKey = new Map<string, Resource[]>();

    for (const resource of resources) {
      const key = `${resource.type}:${resource.name}`;
      const entries = resourcesByKey.get(key) ?? [];
      entries.push(resource);
      resourcesByKey.set(key, entries);
    }

    return [...resourcesByKey.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([key, entries]) => ({
        severity: "error",
        message: `Duplicate resource in plugin: ${key}`,
        detail: `${entries.length} resources share the same selector`,
      }));
  },
};
