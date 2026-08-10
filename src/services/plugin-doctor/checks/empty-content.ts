import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";

export const emptyContentCheck = {
  id: "empty-content",
  description: "Detect resources whose content is empty or whitespace",
  run({ resources }: PluginDoctorContext): PluginDoctorCheckResult[] {
    return resources
      .filter((resource) => !resource.content.trim())
      .map((resource) => ({
        severity: "warn",
        message: `Resource has empty content: ${resource.type}:${resource.name}`,
      }));
  },
};
