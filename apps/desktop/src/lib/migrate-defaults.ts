import type { MigrateScope } from "./types";

export type MigrateExportStep = "scope" | "target" | "options" | "path" | "confirm";
export type MigrateImportStep = "path" | "scope" | "confirm";

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
}): string {
  switch (input.scope) {
    case "workspace":
      return "harnesstap-migrate.tar.gz";
    case "plugin": {
      const first = (input.plugin ?? "plugin").split(",")[0]?.trim() || "plugin";
      return `${first}.ap.json`;
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
