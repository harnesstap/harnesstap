import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  exportScopedMigration,
  importScopedMigration,
  resolveExportScope,
  resolveImportScope,
  type ScopedExportResult,
  type ScopedImportResult,
} from "../../services/migrate-scope.js";
import { runMigrateExportWizard } from "../../services/wizards/migrate-export.js";
import { runMigrateImportWizard } from "../../services/wizards/migrate-import.js";
import { shouldUseWizard } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount } from "../formatting.js";
import { configureCommandGroup } from "../help.js";

function printMigrateExportHuman(result: ScopedExportResult): void {
  switch (result.scope) {
    case "workspace":
      ui.success(
        `Exported migration archive ${ui.icons.hint} ${result.output} ${ui.icons.bullet} ${result.manifest.layer_count} layers, ${result.manifest.environment_count} environments`,
      );
      return;
    case "layer":
      ui.success(
        `Exported layer ${ui.theme.accent(result.layers.join(", "))} ${ui.icons.hint} ${result.output}`,
      );
      return;
    case "resource":
      ui.success(
        `Exported resource ${ui.theme.accent(result.resource)} ${ui.icons.hint} ${result.output}`,
      );
      return;
    case "environment":
      ui.success(
        `Exported environment ${ui.theme.accent(result.environment)} ${ui.icons.hint} ${result.output}`,
      );
      return;
    default: {
      const neverResult: never = result;
      throw new Error(`Unsupported export result: ${String(neverResult)}`);
    }
  }
}

function printMigrateImportHuman(result: ScopedImportResult): void {
  switch (result.scope) {
    case "workspace":
      ui.success(
        `Imported migration archive ${ui.icons.bullet} ${formatCount(result.layers_imported, "layer")}, ${formatCount(result.environments_imported, "environment")}`,
      );
      return;
    case "layer":
      ui.success(
        `Imported layer ${ui.theme.accent(result.layer)} ${ui.icons.bullet} ${formatCount(result.resources_imported, "resource")}`,
      );
      return;
    case "resource":
      ui.success(
        `Imported resource ${ui.theme.accent(result.resource)} ${ui.icons.bullet} ${result.action}`,
      );
      return;
    case "environment":
      ui.success(
        `Imported environment ${ui.theme.accent(result.environment)} ${ui.icons.bullet} ${formatCount(result.imported_keys.length, "var")}`,
      );
      return;
    default: {
      const neverResult: never = result;
      throw new Error(`Unsupported import result: ${String(neverResult)}`);
    }
  }
}

async function handleMigrateExportCommand(
  file: string | undefined,
  opts: {
    file?: string;
    workspace?: boolean;
    layer?: string;
    resource?: string;
    environment?: string;
    includePlugins?: boolean;
    embedPlugins?: boolean;
    format?: string;
    noInteractive?: boolean;
    interactive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db, { allowLegacyRead: true });
  const format = parseOutputFormat(opts.format);

  let exportOpts = {
    ...opts,
    file: opts.file ?? file,
  };

  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    missingRequiredArgs:
      !exportOpts.file
      && !exportOpts.layer
      && !exportOpts.resource
      && !exportOpts.environment
      && !exportOpts.workspace,
  });

  if (useWizard) {
    const wizard = await runMigrateExportWizard();
    exportOpts = {
      ...exportOpts,
      file: wizard.outputPath,
      workspace: wizard.scope === "workspace" ? true : undefined,
      layer: wizard.layer,
      resource: wizard.resource,
      environment: wizard.environment,
      includePlugins: wizard.embedPlugins,
    };
  }

  try {
    const resolved = resolveExportScope(exportOpts);
    const result = exportScopedMigration(resolved, exportOpts);
    if (format === "json") {
      if (result.scope === "workspace") {
        printJson({ ...result.manifest, output: result.output, scope: result.scope });
        return;
      }
      printJson(result);
      return;
    }
    printMigrateExportHuman(result);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handleMigrateImportCommand(
  file: string | undefined,
  opts: {
    workspace?: boolean;
    layer?: boolean;
    resource?: boolean;
    environment?: boolean;
    format?: string;
    noInteractive?: boolean;
    interactive?: boolean;
  } = {},
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  let importFile = file;
  let scopeOverride: ReturnType<typeof resolveImportScope> | undefined;

  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    missingRequiredArgs: !importFile,
  });

  if (useWizard) {
    const wizard = await runMigrateImportWizard();
    importFile = wizard.file;
    scopeOverride = wizard.scope;
  }

  if (!importFile) {
    ui.danger("Import file path is required.");
    process.exitCode = 1;
    return;
  }

  try {
    const scope = scopeOverride ?? resolveImportScope({ ...opts, file: importFile });
    const result = importScopedMigration(scope, importFile);
    if (format === "json") {
      printJson(result);
      return;
    }
    printMigrateImportHuman(result);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

export function registerMigrateCommands(root: Command): void {
  const migrateCmd = configureCommandGroup(
    root
      .command("migrate")
      .alias("m")
      .description("Export or import workspace, layers, environments, or resources for offline sharing"),
  );

  migrateCmd
    .command("export")
    .argument("[file]", "Output path (.tar.gz, .json, or .harnessdeck.toml)")
    .option("--workspace", "Export full workspace archive")
    .option("--layer <name>", "Export layer(s); comma-separated names or IDs")
    .option("--resource <selector>", "Export one resource (type:name or type:name@namespace)")
    .option("--environment <name>", "Export one environment as TOML")
    .option("-o, --file <path>", "Output path (overrides positional)")
    .option("--include-plugins", "Embed plugin trees (workspace and layer scope)")
    .option("--embed-plugins", "Alias for --include-plugins")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Export workspace, layer, or resource for offline sharing")
    .action(handleMigrateExportCommand);

  migrateCmd
    .command("import")
    .argument("[file]", "Archive or TOML export file")
    .option("--workspace", "Force workspace archive import")
    .option("--layer", "Force layer bundle import")
    .option("--resource", "Force resource document import")
    .option("--environment", "Force environment document import")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Import workspace, layer, or resource from file")
    .action(handleMigrateImportCommand);
}
