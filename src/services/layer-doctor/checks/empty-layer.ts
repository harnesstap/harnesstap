import type { LayerDoctorCheckResult, LayerDoctorContext } from "../layer-doctor.types.js";

export const emptyLayerCheck = {
  id: "empty-layer",
  description: "Detect layers that do not contain any resources",
  run({ resources }: LayerDoctorContext): LayerDoctorCheckResult[] {
    if (resources.length > 0) {
      return [];
    }

    return [
      {
        severity: "warn",
        message: "Layer has no resources",
      },
    ];
  },
};
