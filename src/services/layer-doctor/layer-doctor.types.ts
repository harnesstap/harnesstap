import type { Layer, Resource } from "../../types.js";
import type { LayerPluginRow } from "../../services/layer-composition.js";

export interface LayerDoctorCheckResult {
  severity: "ok" | "warn" | "error";
  message: string;
  detail?: string;
  fix?: string;
}

export interface LayerDoctorContext {
  layer: Layer;
  resources: Resource[];
  plugins: LayerPluginRow[];
}

export interface LayerDoctorCheck {
  id: string;
  description: string;
  run(context: LayerDoctorContext): LayerDoctorCheckResult[];
}

export interface LayerDoctorResult extends LayerDoctorCheckResult {
  check: string;
}
