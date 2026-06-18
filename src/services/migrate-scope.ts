import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { AnyMigrateManifest, MigrateManifest } from "./migrate.js";
import { exportMigrationState, importMigrationState } from "./migrate.js";
import { exportToFile } from "./layer-export.js";
import { importFromFile } from "./layer-import.js";
import {
  exportResourceToFile,
  formatResourceSelector,
  importResourceFromFile,
} from "./resource-import-export.js";
import { parseTransportToml } from "./transport/read.js";
import { LAYER_SCHEMA, RESOURCE_SCHEMA } from "../types.js";

export type MigrateScope = "workspace" | "layer" | "resource";

export interface MigrateExportCliOpts {
  file?: string;
  outputFile?: string;
  workspace?: boolean;
  layer?: string;
  resource?: string;
  includePlugins?: boolean;
  embedPlugins?: boolean;
}

export interface MigrateImportCliOpts {
  file?: string;
  workspace?: boolean;
  layer?: boolean;
  resource?: boolean;
}

export type WorkspaceExportResult = {
  scope: "workspace";
  output: string;
  manifest: MigrateManifest;
};

export type LayerExportResult = {
  scope: "layer";
  output: string;
  layers: string[];
};

export type ResourceExportResult = {
  scope: "resource";
  output: string;
  resource: string;
};

export type ScopedExportResult =
  | WorkspaceExportResult
  | LayerExportResult
  | ResourceExportResult;

export type WorkspaceImportResult = {
  scope: "workspace";
  manifest: AnyMigrateManifest;
  layers_imported: number;
  environments_imported: number;
};

export type LayerImportResult = {
  scope: "layer";
  layer: string;
  layers: string[];
  resources_imported: number;
};

export type ResourceImportResult = {
  scope: "resource";
  resource: string;
  action: "created" | "updated" | "unchanged";
};

export type ScopedImportResult =
  | WorkspaceImportResult
  | LayerImportResult
  | ResourceImportResult;

function countScopeFlags(opts: {
  workspace?: boolean;
  layer?: string | boolean;
  resource?: string | boolean;
}): number {
  let count = 0;
  if (opts.workspace) count++;
  if (opts.layer) count++;
  if (opts.resource) count++;
  return count;
}

export function assertExclusiveScopeFlags(opts: {
  workspace?: boolean;
  layer?: string | boolean;
  resource?: string | boolean;
}): void {
  if (countScopeFlags(opts) > 1) {
    throw new Error("Choose only one of --workspace, --layer, or --resource.");
  }
}

function embedPlugins(opts: MigrateExportCliOpts): boolean {
  return opts.includePlugins ?? opts.embedPlugins ?? false;
}

export function resolveExportScope(opts: MigrateExportCliOpts): {
  scope: MigrateScope;
  outputPath: string;
  layerSelector?: string;
  resourceSelector?: string;
} {
  assertExclusiveScopeFlags(opts);
  const outputPath = opts.outputFile ?? opts.file;

  if (opts.layer) {
    const firstLayer = opts.layer.split(",")[0]?.trim() ?? "layer";
    const path = outputPath && outputPath.length > 0
      ? resolve(outputPath)
      : resolve(`${firstLayer}.harnessdeck.toml`);
    return {
      scope: "layer",
      outputPath: path,
      layerSelector: opts.layer,
    };
  }

  if (opts.resource) {
    const colon = opts.resource.indexOf(":");
    const type = colon === -1 ? "resource" : opts.resource.slice(0, colon);
    const rest = colon === -1 ? opts.resource : opts.resource.slice(colon + 1);
    const name = rest.split("@")[0] ?? "export";
    const path = outputPath && outputPath.length > 0
      ? resolve(outputPath)
      : resolve(`${type}-${name}.harnessdeck.toml`);
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
    "Specify export scope: --workspace, --layer <name>, or --resource <selector>.",
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
    if (schema === LAYER_SCHEMA) return "layer";
    if (schema === RESOURCE_SCHEMA) return "resource";
    throw new Error(`Unsupported TOML schema for migrate import: ${String(schema)}`);
  }
  throw new Error(`Cannot detect import scope for file: ${resolved}`);
}

export function resolveImportScope(opts: MigrateImportCliOpts): MigrateScope {
  assertExclusiveScopeFlags({
    workspace: opts.workspace,
    layer: opts.layer,
    resource: opts.resource,
  });
  if (!opts.file || opts.file.length === 0) {
    throw new Error("Import file path is required.");
  }

  let scope: MigrateScope;
  if (opts.workspace) {
    scope = "workspace";
  } else if (opts.layer) {
    scope = "layer";
  } else if (opts.resource) {
    scope = "resource";
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
    case "layer": {
      if (!resolved.layerSelector) {
        throw new Error("Layer selector is required for layer export.");
      }
      const layers = resolved.layerSelector
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (layers.length === 0) {
        throw new Error("Provide at least one layer name or ID to export.");
      }
      const exportSelector = layers.length === 1 ? layers[0]! : layers;
      exportToFile(exportSelector, resolved.outputPath, {
        embedPlugins: includePlugins,
      });
      return {
        scope: "layer",
        output: resolved.outputPath,
        layers,
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
        layers_imported: result.layers_imported,
        environments_imported: result.environments_imported,
      };
    }
    case "layer": {
      const imported = importFromFile(resolved);
      const layerNames = imported.layers.map((entry) => entry.layer.name);
      const resourcesImported = imported.layers.reduce(
        (total, entry) => total + entry.resources.length,
        0,
      );
      return {
        scope: "layer",
        layer: layerNames.join(", "),
        layers: layerNames,
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
    default: {
      const neverScope: never = scope;
      throw new Error(`Unsupported import scope: ${neverScope}`);
    }
  }
}
