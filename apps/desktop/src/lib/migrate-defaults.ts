import type { MigrateScope } from "./types";

export function defaultMigrateExportFilename(input: {
  scope: MigrateScope;
  layer?: string;
  resource?: string;
  environment?: string;
}): string {
  switch (input.scope) {
    case "workspace":
      return "harnesstap-migrate.tar.gz";
    case "layer": {
      const first = (input.layer ?? "layer").split(",")[0]?.trim() || "layer";
      return `${first}.harnesstap.toml`;
    }
    case "resource": {
      const selector = input.resource ?? "resource:export";
      const colon = selector.indexOf(":");
      const type = colon === -1 ? "resource" : selector.slice(0, colon);
      const rest = colon === -1 ? selector : selector.slice(colon + 1);
      const name = rest.split("@")[0] || "export";
      return `${type}-${name}.harnesstap.toml`;
    }
    case "environment":
      return `${(input.environment ?? "environment").trim() || "environment"}.environment.toml`;
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
