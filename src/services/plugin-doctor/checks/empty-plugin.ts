import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";

export const emptyPluginCheck = {
  id: "empty-plugin",
  description: "Detect plugins that do not contain any resources",
  run({ resources }: PluginDoctorContext): PluginDoctorCheckResult[] {
    if (resources.length > 0) {
      return [];
    }

    return [
      {
        severity: "warn",
        message: "Plugin has no resources",
      },
    ];
  },
};
