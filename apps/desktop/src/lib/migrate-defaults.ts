import type { MigrateScope } from "./types";

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
