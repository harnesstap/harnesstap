import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  formatResourceCounts,
  formatSkippedEntry,
} from "../../services/agent-plugins/import-diagnostics.js";
import {
  exportScopedMigration,
  ImportSkippedFilesError,
  importScopedMigration,
  resolveExportScope,
  resolveImportScope,
  type ScopedExportResult,
  type ScopedImportResult,
} from "../../services/migrate-scope.js";
import {
  migrateOrderToOverrides,
  type OrderMigrationReport,
} from "../../services/order-to-override-migration.js";
import { runMigrateExportWizard } from "../../services/wizards/migrate-export.js";
import { runMigrateImportWizard } from "../../services/wizards/migrate-import.js";
import { shouldUseWizard } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { shortenHomePath } from "../../utils/home-path.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount } from "../formatting.js";
import { configureCommandGroup } from "../help.js";
import { fail, failCaught } from "../shared.js";

function printMigrateExportHuman(result: ScopedExportResult): void {
  const output = shortenHomePath(result.output);
  switch (result.scope) {
    case "workspace":
      ui.success(
        `Exported migration archive ${ui.icons.hint} ${output} ${ui.icons.bullet} ${formatCount(result.manifest.plugin_count, "plugin")}, ${formatCount(result.manifest.environment_count, "environment")}`,
      );
      return;
    case "plugin":
      ui.success(
        `Exported plugin ${ui.theme.accent(result.plugins.join(", "))} ${ui.icons.hint} ${output}`,
      );
      return;
    case "resource":
      ui.success(
        `Exported resource ${ui.theme.accent(result.resource)} ${ui.icons.hint} ${output}`,
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
        `Imported migration archive ${ui.icons.bullet} ${formatCount(result.plugins_imported, "plugin")}, ${formatCount(result.environments_imported, "environment")}`,
      );
      return;
    case "plugin":
      for (const item of result.skipped) {
        ui.warn(`skipped ${formatSkippedEntry(item)}`);
      }
      ui.success(
        `Imported plugin ${ui.theme.accent(result.plugin)} ${ui.icons.bullet} ${formatCount(result.resources_imported, "resource")}`,
      );
      ui.info(`Resources, imported of discovered: ${formatResourceCounts(result.resource_counts)}`);
      if (result.skipped.length > 0) {
        ui.warn(
          `${formatCount(result.skipped.length, "file")} not imported. Fix them and import again; --strict refuses the import instead.`,
        );
      }
      return;
    case "resource":
      ui.success(
        `Imported resource ${ui.theme.accent(result.resource)} ${ui.icons.bullet} ${result.action}`,
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
    plugin?: string;
    resource?: string;
    environment?: string;
    includePlugins?: boolean;
    embedPlugins?: boolean;
    singleFile?: boolean;
    archive?: boolean;
    vendorExtensions?: boolean;
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
      && !exportOpts.plugin
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
      plugin: wizard.plugin,
      resource: wizard.resource,
      includePlugins: wizard.embedPlugins,
      singleFile: wizard.singleFile,
    };
  }

  try {
    const resolved = resolveExportScope(exportOpts);
    const result = exportScopedMigration(resolved, {
      ...exportOpts,
      onSkip: (message) => ui.warn(message),
    });
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
    fail(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handleMigrateImportCommand(
  file: string | undefined,
  opts: {
    workspace?: boolean;
    plugin?: boolean;
    resource?: boolean;
    environment?: boolean;
    strict?: boolean;
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
    fail("Import file path is required.");
    process.exitCode = 1;
    return;
  }

  try {
    const scope = scopeOverride ?? resolveImportScope({ ...opts, file: importFile });
    // Scripts and CI fail on skipped files unless they opt out with --no-strict.
    const strict = opts.strict ?? !shouldUseWizard({
      interactive: true,
      noInteractive: opts.noInteractive,
      format: opts.format,
      missingRequiredArgs: false,
    });
    const result = importScopedMigration(scope, importFile, { strict });
    if (format === "json") {
      printJson(result);
      return;
    }
    printMigrateImportHuman(result);
  } catch (err) {
    if (err instanceof ImportSkippedFilesError) {
      if (format === "json") {
        printJson({
          scope: "plugin",
          imported: false,
          error: "skipped_files",
          skipped: err.diagnostics.skipped,
          resource_counts: err.diagnostics.counts,
        });
        process.exitCode = 1;
        return;
      }
      for (const item of err.diagnostics.skipped) {
        ui.warn(`skipped ${formatSkippedEntry(item)}`);
      }
      ui.info(`Would import, of discovered: ${formatResourceCounts(err.diagnostics.counts)}`);
      fail(
        `Not imported: ${formatCount(err.diagnostics.skipped.length, "file")} would be skipped.`,
        { hint: "Fix the files, or pass --no-strict to import the rest anyway." },
      );
      return;
    }
    failCaught(err);
  }
}

function printMigrateResolveOrderHuman(
  report: OrderMigrationReport,
  dryRun: boolean,
): void {
  const dryRunSuffix = dryRun ? ` ${ui.icons.bullet} dry-run` : "";
  if (report.overridesWritten.length === 0) {
    const aligned =
      report.projectsWithSnapshot > 0
        ? "Last applied winners already match current resolution. No overrides to write"
        : "No apply snapshots to compare. No overrides to write";
    ui.success(`${aligned}${dryRunSuffix}`);
  } else {
    const overrideCount = formatCount(report.overridesWritten.length, "override");
    const projectCount = formatCount(report.projectsWithSnapshot, "project");
    const verb = dryRun ? "Would write" : "Wrote";
    ui.success(
      `${verb} ${overrideCount} across ${projectCount}${dryRunSuffix}`,
    );
  }
  for (const warning of report.warnings) {
    ui.warn(warning);
  }
}

function handleMigrateResolveOrderCommand(opts: {
  dryRun?: boolean;
  format?: string;
}): void {
  const db = getDb();
  initializeSchema(db, { allowLegacyRead: true });
  const format = parseOutputFormat(opts.format);
  const dryRun = opts.dryRun === true;
  const report = migrateOrderToOverrides({ dryRun });
  if (format === "json") {
    printJson(report);
    return;
  }
  printMigrateResolveOrderHuman(report, dryRun);
}

export function registerMigrateCommands(root: Command): void {
  const migrateCmd = configureCommandGroup(
    root
      .command("migrate")
      .alias("m")
      .description("Export or import workspace, plugins, or resources for offline sharing"),
  );

  migrateCmd
    .command("export")
    .argument(
      "[file]",
      "Output path (package directory, .ap.json envelope, or .tar.gz workspace archive)",
    )
    .option("--workspace", "Export full workspace archive")
    .option("--plugin <name>", "Export plugin(s); comma-separated names or IDs")
    .option("--resource <selector>", "Export one resource (type:name or type:name@namespace)")
    .option(
      "--environment <name>",
      "Removed: environments are machine-local; use --workspace",
    )
    .option("--single-file", "Write a .ap.json envelope instead of a package directory")
    .option("--archive", "Write a .zip of the Agent Plugins package")
    .option(
      "--vendor-extensions",
      "Also write com.github.copilot files and Codex hook settings",
    )
    .option("-o, --file <path>", "Output path (overrides positional)")
    .option("--include-plugins", "Embed plugin trees (workspace scope)")
    .option("--embed-plugins", "Alias for --include-plugins")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Export workspace, plugin, or resource for offline sharing")
    .action(handleMigrateExportCommand);

  migrateCmd
    .command("import")
    .argument(
      "[file]",
      "package directory, .ap.json envelope, or .tar.gz workspace archive",
    )
    .option("--workspace", "Force workspace archive import")
    .option("--plugin", "Force Agent Plugins package import")
    .option("--resource", "Force single-resource package import")
    .option(
      "--strict",
      "Refuse a plugin package with skipped files (default when not interactive)",
    )
    .option("--no-strict", "Import a plugin package even when some files are skipped")
    .option(
      "--environment",
      "Removed: environments are machine-local; use --workspace",
    )
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Import workspace, plugin, or resource from file")
    .action(handleMigrateImportCommand);

  migrateCmd
    .command("resolve-order")
    .option("--dry-run", "Report what would be written without writing")
    .option("--format <mode>", "Output format: human or json", "human")
    .description(
      "Pin last-applied resource winners as overrides where current resolution would pick a different plugin",
    )
    .action(handleMigrateResolveOrderCommand);
}
