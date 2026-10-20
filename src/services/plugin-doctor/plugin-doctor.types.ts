import type { Plugin, Resource } from "../../types.js";
import type { PackageImportDiagnostics } from "../agent-plugins/import-diagnostics.js";
import type { DependencyView } from "../plugin-dependency.js";

export interface PluginDoctorCheckResult {
  severity: "ok" | "warn" | "error";
  message: string;
  detail?: string;
  fix?: string;
}

export interface PluginDoctorContext {
  plugin: Plugin;
  resources: Resource[];
  plugins: DependencyView[];
  /** Load of the installed package this plugin was imported from, when there is one. */
  packageDiagnostics?: PackageImportDiagnostics;
}

export interface PluginDoctorCheck {
  id: string;
  description: string;
  run(context: PluginDoctorContext): PluginDoctorCheckResult[];
}

export interface PluginDoctorResult extends PluginDoctorCheckResult {
  check: string;
}
