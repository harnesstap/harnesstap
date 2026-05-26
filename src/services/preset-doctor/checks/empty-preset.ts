import type { PresetDoctorCheckResult, PresetDoctorContext } from "../preset-doctor.types.js";

export const emptyPresetCheck = {
  id: "empty-preset",
  description: "Detect presets that do not contain any resources",
  run({ resources }: PresetDoctorContext): PresetDoctorCheckResult[] {
    if (resources.length > 0) {
      return [];
    }

    return [
      {
        severity: "warn",
        message: "Preset has no resources",
      },
    ];
  },
};
