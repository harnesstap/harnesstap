import { existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { getPlugin, getPluginResources } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import {
  buildApPackageFiles,
  writeApPackageFiles,
} from "./agent-plugins/files.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import {
  isApEnvelopePath,
  writeApEnvelope,
} from "./agent-plugins/envelope.js";
import { slugifyApName } from "./agent-plugins/name.js";
import { loadVerifiedPackageFiles } from "./apm-bundle.js";
import {
  isLegacyTomlTransportPath,
  legacyTomlTransportRejection,
} from "./legacy-toml-transport.js";
import type { AnyMigrateManifest, MigrateManifest } from "./migrate.js";
import { exportMigrationState, importMigrationState } from "./migrate.js";
import { assertPluginsCleanForShare } from "./plugin-versioning.js";
import {
  exportResourceToFile,
  formatResourceSelector,
  importResourceFromFile,
} from "./resource-import-export.js";

export type MigrateScope = "workspace" | "plugin" | "resource";

export interface MigrateExportCliOpts {
  file?: string;
  outputFile?: string;
  workspace?: boolean;
  plugin?: string;
  resource?: string;
  /** Deprecated — rejected by {@link rejectEnvironmentScope}. */
  environment?: string;
  includePlugins?: boolean;
  embedPlugins?: boolean;
  singleFile?: boolean;
}

export interface MigrateImportCliOpts {
  file?: string;
  workspace?: boolean;
  plugin?: boolean;
  resource?: boolean;
  /** Deprecated — rejected by {@link rejectEnvironmentScope}. */
  environment?: boolean | string;
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
  files: string[];
};

export type ResourceExportResult = {
  scope: "resource";
  output: string;
  resource: string;
  files: string[];
};

export type ScopedExportResult =
  | WorkspaceExportResult
  | PluginExportResult
  | ResourceExportResult;

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

export type ScopedImportResult =
  | WorkspaceImportResult
  | PluginImportResult
  | ResourceImportResult;

function countScopeFlags(opts: {
  workspace?: boolean;
  plugin?: string | boolean;
  resource?: string | boolean;
}): number {
  let count = 0;
  if (opts.workspace) count++;
  if (opts.plugin) count++;
  if (opts.resource) count++;
  return count;
}

export function assertExclusiveScopeFlags(opts: {
  workspace?: boolean;
  plugin?: string | boolean;
  resource?: string | boolean;
}): void {
  if (countScopeFlags(opts) > 1) {
    throw new Error("Choose only one of --workspace, --plugin, or --resource.");
  }
}

export function rejectEnvironmentScope(opts: { environment?: string | boolean }): void {
  if (opts.environment) {
    throw new Error(
      "Environments are no longer exported on their own — they are machine-local " +
        "secret references. Use --workspace to back them up with everything else.",
    );
  }
}

function embedPlugins(opts: MigrateExportCliOpts): boolean {
  return opts.includePlugins ?? opts.embedPlugins ?? false;
}

function resolvePluginOrThrow(selector: string): Plugin {
  const first = selector.split(",")[0]?.trim() ?? selector;
  const plugin = getPlugin(first);
  if (!plugin) {
    throw new Error(`Plugin not found: ${first}`);
  }
  return plugin;
}

export function resolveExportScope(opts: MigrateExportCliOpts): {
  scope: MigrateScope;
  outputPath: string;
  pluginSelector?: string;
  resourceSelector?: string;
  singleFile: boolean;
} {
  rejectEnvironmentScope(opts);
  assertExclusiveScopeFlags(opts);
  const outputPath = opts.outputFile ?? opts.file;
  const resolvedExplicit =
    outputPath && outputPath.length > 0 ? resolve(outputPath) : undefined;
  const singleFile =
    opts.singleFile === true
    || (resolvedExplicit != null && isApEnvelopePath(resolvedExplicit));

  if (opts.plugin) {
    const firstPlugin = opts.plugin.split(",")[0]?.trim() ?? "plugin";
    const apName = slugifyApName(firstPlugin);
    const path = resolvedExplicit ?? resolve(singleFile ? `${apName}.ap.json` : apName);
    return {
      scope: "plugin",
      outputPath: path,
      pluginSelector: opts.plugin,
      singleFile,
    };
  }

  if (opts.resource) {
    const colon = opts.resource.indexOf(":");
    const rest = colon === -1 ? opts.resource : opts.resource.slice(colon + 1);
    const name = slugifyApName(rest.split("@")[0] ?? "export");
    const path = resolvedExplicit ?? resolve(singleFile ? `${name}.ap.json` : name);
    return {
      scope: "resource",
      outputPath: path,
      resourceSelector: opts.resource,
      singleFile,
    };
  }

  if (opts.workspace) {
    if (!outputPath || outputPath.length === 0) {
      throw new Error("Output path is required for workspace export.");
    }
    return { scope: "workspace", outputPath: resolve(outputPath), singleFile: false };
  }

  if (outputPath && outputPath.length > 0) {
    const resolvedOutput = resolve(outputPath);
    const lower = resolvedOutput.toLowerCase();
    if (lower.endsWith(".tar.gz")) {
      return { scope: "workspace", outputPath: resolvedOutput, singleFile: false };
    }
    if (
      extname(resolvedOutput).toLowerCase() === ".json"
      && !isApEnvelopePath(resolvedOutput)
    ) {
      return { scope: "workspace", outputPath: resolvedOutput, singleFile: false };
    }
  }

  throw new Error(
    "Specify export scope: --workspace, --plugin <name>, or --resource <selector>.",
  );
}

export function detectImportScopeFromFile(filePath: string): MigrateScope {
  const resolved = resolve(filePath);
  if (statSync(resolved).isDirectory()) {
    if (!existsSync(join(resolved, "plugin.json"))) {
      throw new Error(
        `${resolved} is a directory but has no plugin.json — expected an Agent Plugins package.`,
      );
    }
    return "plugin";
  }
  const lower = resolved.toLowerCase();
  if (lower.endsWith(".tar.gz")) return "workspace";
  if (isApEnvelopePath(resolved) || lower.endsWith(".zip")) return "plugin";
  if (isLegacyTomlTransportPath(resolved)) {
    throw new Error(legacyTomlTransportRejection(resolved));
  }
  throw new Error(
    `Cannot tell what ${resolved} is. Pass an Agent Plugins package directory, ` +
      "an .ap.json envelope, or a .tar.gz workspace archive.",
  );
}

export function resolveImportScope(opts: MigrateImportCliOpts): MigrateScope {
  rejectEnvironmentScope(opts);
  assertExclusiveScopeFlags({
    workspace: opts.workspace,
    plugin: opts.plugin,
    resource: opts.resource,
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
      const plugin = resolvePluginOrThrow(resolved.pluginSelector);
      assertPluginsCleanForShare([plugin]);
      const files = buildApPackageFiles(plugin.id);
      let written: string[];
      if (resolved.singleFile) {
        writeApEnvelope(files, resolved.outputPath);
        written = Object.keys(files).sort();
      } else {
        written = writeApPackageFiles(files, resolved.outputPath);
      }
      return {
        scope: "plugin",
        output: resolved.outputPath,
        plugins: [plugin.name],
        files: written,
      };
    }
    case "resource": {
      if (!resolved.resourceSelector) {
        throw new Error("Resource selector is required for resource export.");
      }
      const exportDoc = exportResourceToFile(
        resolved.resourceSelector,
        resolved.outputPath,
        { singleFile: resolved.singleFile },
      );
      return {
        scope: "resource",
        output: resolved.outputPath,
        resource: formatResourceSelector(exportDoc),
        files: exportDoc.files,
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
      const files = loadVerifiedPackageFiles(resolved);
      const plugin = importApPackageFiles(files);
      return {
        scope: "plugin",
        plugin: plugin.name,
        plugins: [plugin.name],
        resources_imported: getPluginResources(plugin.id).length,
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
