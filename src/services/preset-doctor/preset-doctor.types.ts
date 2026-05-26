import type { Preset, Resource } from "../../types.js";
import type { PresetPluginRow } from "../../models/plugin.js";

export interface PresetDoctorCheckResult {
  severity: "ok" | "warn" | "error";
  message: string;
  detail?: string;
  fix?: string;
}

export interface PresetDoctorContext {
  preset: Preset;
  resources: Resource[];
  plugins: PresetPluginRow[];
}

export interface PresetDoctorCheck {
  id: string;
  description: string;
  run(context: PresetDoctorContext): PresetDoctorCheckResult[];
}

export interface PresetDoctorResult extends PresetDoctorCheckResult {
  check: string;
}
