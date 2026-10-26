import type { MigrateScope } from "./types";

export type MigrateExportStep = "scope" | "target" | "options" | "path" | "confirm";
export type MigrateImportStep = "path" | "scope" | "confirm";
export type PluginPackageFormat = "directory" | "zip" | "envelope";

export function migrateExportSteps(scope: MigrateScope): readonly MigrateExportStep[] {
  switch (scope) {
    case "workspace":
      return ["scope", "options", "path", "confirm"];
    case "plugin":
      return ["scope", "target", "options", "path", "confirm"];
    case "resource":
      return ["scope", "target", "path", "confirm"];
    default: {
      const neverScope: never = scope;
      return neverScope;
    }
  }
}

export function migrateImportSteps(): readonly MigrateImportStep[] {
  return ["path", "scope", "confirm"];
}

export function migrateStepCopy(current: number, total: number): string {
  return `Step ${current} of ${total}`;
}

export function migrateStepPosition<T extends string>(
  steps: readonly T[],
  step: T,
): { current: number; total: number } {
  const index = steps.indexOf(step);
  return {
    current: index >= 0 ? index + 1 : 1,
    total: steps.length,
  };
}

export function defaultMigrateExportFilename(input: {
  scope: MigrateScope;
  plugin?: string;
  resource?: string;
  packageFormat?: PluginPackageFormat;
}): string {
  switch (input.scope) {
    case "workspace":
      return "harnesstap-migrate.tar.gz";
    case "plugin": {
      const first = (input.plugin ?? "plugin").split(",")[0]?.trim() || "plugin";
      const format = input.packageFormat ?? "envelope";
      switch (format) {
        case "directory":
          return first;
        case "zip":
          return `${first}.zip`;
        case "envelope":
          return `${first}.ap.json`;
        default: {
          const neverFormat: never = format;
          return neverFormat;
        }
      }
    }
    case "resource": {
      const selector = input.resource ?? "resource:export";
      const colon = selector.indexOf(":");
      const type = colon === -1 ? "resource" : selector.slice(0, colon);
      const rest = colon === -1 ? selector : selector.slice(colon + 1);
      const name = rest.split("@")[0] || "export";
      return `${type}-${name}.ap.json`;
    }
    default: {
      const neverScope: never = input.scope;
      throw new Error(`Unsupported migrate scope: ${String(neverScope)}`);
    }
  }
}

export function formatResourceSelector(resource: {
  type: string;
  name: string;
  namespace?: string | null;
}): string {
  return `${resource.type}:${resource.name}${
    resource.namespace ? `@${resource.namespace}` : ""
  }`;
}

export interface MigrateScopeOption {
  value: MigrateScope;
  label: string;
  description: string;
}

export const MIGRATE_EXPORT_SCOPE_HEADING = "What do you want to export?";
export const MIGRATE_IMPORT_SCOPE_HEADING = "What is in this file?";
export const MIGRATE_NO_FILE_COPY = "No file selected";
export const MIGRATE_CHOOSE_FILE_COPY = "Choose file";

export const migrateExportScopeOptions: readonly MigrateScopeOption[] = [
  {
    value: "workspace",
    label: "Full workspace",
    description: "Everything, as one archive.",
  },
  {
    value: "plugin",
    label: "Plugin package",
    description: "One plugin, in the Agent Plugins format other tools can read.",
  },
  {
    value: "resource",
    label: "HarnessTap package",
    description: "One resource, for HarnessTap and Cloud.",
  },
];

export const migrateImportScopeOptions: readonly MigrateScopeOption[] = [
  {
    value: "workspace",
    label: "Full workspace",
    description: "An archive of a whole HarnessTap setup.",
  },
  {
    value: "plugin",
    label: "Plugin package",
    description: "One plugin in the Agent Plugins format.",
  },
  {
    value: "resource",
    label: "Single resource",
    description: "One resource from a HarnessTap package.",
  },
];
