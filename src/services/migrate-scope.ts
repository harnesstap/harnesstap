import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { AnyMigrateManifest, MigrateManifest } from "./migrate.js";
import { exportMigrationState, importMigrationState } from "./migrate.js";
import {
  exportEnvironmentToml,
  importEnvironmentFile,
} from "./environment-import-export.js";
import { exportToFile } from "./plugin-export.js";
import { importFromFile } from "./plugin-import.js";
import {
  exportResourceToFile,
  formatResourceSelector,
  importResourceFromFile,
} from "./resource-import-export.js";
import { parseTransportToml } from "./transport/read.js";
import { PLUGIN_SCHEMA, RESOURCE_SCHEMA } from "../types.js";

export type MigrateScope = "workspace" | "plugin" | "resource" | "environment";

export interface MigrateExportCliOpts {
  file?: string;
  outputFile?: string;
  workspace?: boolean;
  plugin?: string;
  resource?: string;
  environment?: string;
  includePlugins?: boolean;
  embedPlugins?: boolean;
}

export interface MigrateImportCliOpts {
  file?: string;
  workspace?: boolean;
  plugin?: boolean;
  resource?: boolean;
  environment?: boolean;
}

export type WorkspaceExportResult = {
  scope: "workspace";
  output: string;
  manifest: MigrateManifest;
};

export type PluginExportResult = {
  scope: "plugin";
  output: string;
  plugins: string[];
};

export type ResourceExportResult = {
  scope: "resource";
  output: string;
  resource: string;
};

export type EnvironmentExportResult = {
  scope: "environment";
  output: string;
  environment: string;
};

export type ScopedExportResult =
  | WorkspaceExportResult
  | PluginExportResult
  | ResourceExportResult
  | EnvironmentExportResult;

export type WorkspaceImportResult = {
  scope: "workspace";
  manifest: AnyMigrateManifest;
  plugins_imported: number;
  environments_imported: number;
};

export type PluginImportResult = {
  scope: "plugin";
  plugin: string;
  plugins: string[];
  resources_imported: number;
};

export type ResourceImportResult = {
  scope: "resource";
  resource: string;
  action: "created" | "updated" | "unchanged";
};

export type EnvironmentImportResult = {
  scope: "environment";
  environment: string;
  imported_keys: string[];
  imported_secret_refs: string[];
};

export type ScopedImportResult =
  | WorkspaceImportResult
  | PluginImportResult
  | ResourceImportResult
  | EnvironmentImportResult;

function countScopeFlags(opts: {
  workspace?: boolean;
  plugin?: string | boolean;
  resource?: string | boolean;
  environment?: string | boolean;
}): number {
  let count = 0;
  if (opts.workspace) count++;
  if (opts.plugin) count++;
  if (opts.resource) count++;
  if (opts.environment) count++;
  return count;
}

export function assertExclusiveScopeFlags(opts: {
  workspace?: boolean;
  plugin?: string | boolean;
  resource?: string | boolean;
  environment?: string | boolean;
}): void {
  if (countScopeFlags(opts) > 1) {
    throw new Error("Choose only one of --workspace, --plugin, --resource, or --environment.");
  }
}

function embedPlugins(opts: MigrateExportCliOpts): boolean {
  return opts.includePlugins ?? opts.embedPlugins ?? false;
}

function isEnvironmentTomlDocument(document: Record<string, unknown>): boolean {
  if (document.$schema === PLUGIN_SCHEMA || document.$schema === RESOURCE_SCHEMA) {
    return false;
  }
  if (document.environments && typeof document.environments === "object") {
    return true;
  }
  return typeof document.name === "string" && document.values !== undefined;
}

export function resolveExportScope(opts: MigrateExportCliOpts): {
  scope: MigrateScope;
  outputPath: string;
  pluginSelector?: string;
  resourceSelector?: string;
  environmentSelector?: string;
} {
  assertExclusiveScopeFlags(opts);
  const outputPath = opts.outputFile ?? opts.file;

  if (opts.environment) {
    const path = outputPath && outputPath.length > 0
      ? resolve(outputPath)
      : resolve(`${opts.environment}.environment.toml`);
    return {
      scope: "environment",
      outputPath: path,
      environmentSelector: opts.environment,
    };
  }

  if (opts.plugin) {
    const firstPlugin = opts.plugin.split(",")[0]?.trim() ?? "plugin";
    const path = outputPath && outputPath.length > 0
      ? resolve(outputPath)
      : resolve(`${firstPlugin}.harnesstap.toml`);
    return {
      scope: "plugin",
      outputPath: path,
      pluginSelector: opts.plugin,
    };
  }

  if (opts.resource) {
    const colon = opts.resource.indexOf(":");
    const type = colon === -1 ? "resource" : opts.resource.slice(0, colon);
    const rest = colon === -1 ? opts.resource : opts.resource.slice(colon + 1);
    const name = rest.split("@")[0] ?? "export";
    const path = outputPath && outputPath.length > 0
      ? resolve(outputPath)
      : resolve(`${type}-${name}.harnesstap.toml`);
    return {
      scope: "resource",
      outputPath: path,
      resourceSelector: opts.resource,
    };
  }

  if (opts.workspace) {
    if (!outputPath || outputPath.length === 0) {
      throw new Error("Output path is required for workspace export.");
    }
    return { scope: "workspace", outputPath: resolve(outputPath) };
  }

  if (outputPath && outputPath.length > 0) {
    const resolvedOutput = resolve(outputPath);
    const lower = resolvedOutput.toLowerCase();
    if (lower.endsWith(".tar.gz") || extname(resolvedOutput).toLowerCase() === ".json") {
      return { scope: "workspace", outputPath: resolvedOutput };
    }
  }

  throw new Error(
    "Specify export scope: --workspace, --plugin <name>, --resource <selector>, or --environment <name>.",
  );
}

export function detectImportScopeFromFile(filePath: string): MigrateScope {
  const resolved = resolve(filePath);
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".tar.gz") || extname(resolved).toLowerCase() === ".json") {
    return "workspace";
  }
  if (extname(resolved).toLowerCase() === ".toml") {
    const document = parseTransportToml(
      readFileSync(resolved, "utf-8"),
      "migrate import",
    );
    const schema = document.schema;
    if (schema === PLUGIN_SCHEMA) return "plugin";
    if (schema === RESOURCE_SCHEMA) return "resource";
    if (isEnvironmentTomlDocument(document)) return "environment";
    throw new Error(`Unsupported TOML schema for migrate import: ${String(schema)}`);
  }
  throw new Error(`Cannot detect import scope for file: ${resolved}`);
}

export function resolveImportScope(opts: MigrateImportCliOpts): MigrateScope {
  assertExclusiveScopeFlags({
    workspace: opts.workspace,
    plugin: opts.plugin,
    resource: opts.resource,
    environment: opts.environment,
  });
  if (!opts.file || opts.file.length === 0) {
    throw new Error("Import file path is required.");
  }

  let scope: MigrateScope;
  if (opts.workspace) {
    scope = "workspace";
  } else if (opts.plugin) {
    scope = "plugin";
  } else if (opts.resource) {
    scope = "resource";
  } else if (opts.environment) {
    scope = "environment";
  } else {
    return detectImportScopeFromFile(opts.file);
  }

  const detected = detectImportScopeFromFile(opts.file);
  if (detected !== scope) {
    throw new Error(
      `Import file looks like ${detected} data but --${scope} was specified.`,
    );
  }
  return scope;
}

export function exportScopedMigration(
  resolved: ReturnType<typeof resolveExportScope>,
  opts: MigrateExportCliOpts,
): ScopedExportResult {
  const includePlugins = embedPlugins(opts);

  switch (resolved.scope) {
    case "workspace": {
      const manifest = exportMigrationState({
        outputPath: resolved.outputPath,
        includePlugins,
      });
      return {
        scope: "workspace",
        output: resolved.outputPath,
        manifest,
      };
    }
    case "plugin": {
      if (!resolved.pluginSelector) {
        throw new Error("Plugin selector is required for plugin export.");
      }
      const plugins = resolved.pluginSelector
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (plugins.length === 0) {
        throw new Error("Provide at least one plugin name or ID to export.");
      }
      const exportSelector = plugins.length === 1 ? (plugins[0] ?? plugins) : plugins;
      exportToFile(exportSelector, resolved.outputPath, {
        embedPlugins: includePlugins,
      });
      return {
        scope: "plugin",
        output: resolved.outputPath,
        plugins,
      };
    }
    case "resource": {
      if (!resolved.resourceSelector) {
        throw new Error("Resource selector is required for resource export.");
      }
      const exportDoc = exportResourceToFile(
        resolved.resourceSelector,
        resolved.outputPath,
      );
      return {
        scope: "resource",
        output: resolved.outputPath,
        resource: formatResourceSelector(exportDoc),
      };
    }
    case "environment": {
      if (!resolved.environmentSelector) {
        throw new Error("Environment selector is required for environment export.");
      }
      const { environment, toml } = exportEnvironmentToml(resolved.environmentSelector);
      writeFileSync(resolved.outputPath, toml, "utf-8");
      return {
        scope: "environment",
        output: resolved.outputPath,
        environment: environment.name,
      };
    }
    default: {
      const neverScope: never = resolved.scope;
      throw new Error(`Unsupported export scope: ${neverScope}`);
    }
  }
}

export function importScopedMigration(
  scope: MigrateScope,
  filePath: string,
): ScopedImportResult {
  const resolved = resolve(filePath);

  switch (scope) {
    case "workspace": {
      const result = importMigrationState({ archivePath: resolved });
      return {
        scope: "workspace",
        manifest: result.manifest,
        plugins_imported: result.plugins_imported,
        environments_imported: result.environments_imported,
      };
    }
    case "plugin": {
      const imported = importFromFile(resolved);
      const pluginNames = imported.plugins.map((entry) => entry.plugin.name);
      const resourcesImported = imported.plugins.reduce(
        (total, entry) => total + entry.resources.length,
        0,
      );
      return {
        scope: "plugin",
        plugin: pluginNames.join(", "),
        plugins: pluginNames,
        resources_imported: resourcesImported,
      };
    }
    case "resource": {
      const result = importResourceFromFile(resolved);
      return {
        scope: "resource",
        resource: formatResourceSelector(result.resource),
        action: result.action,
      };
    }
    case "environment": {
      const result = importEnvironmentFile(resolved);
      return {
        scope: "environment",
        environment: result.environment.name,
        imported_keys: result.imported_keys,
        imported_secret_refs: result.imported_secret_refs,
      };
    }
    default: {
      const neverScope: never = scope;
      throw new Error(`Unsupported import scope: ${neverScope}`);
    }
  }
}
