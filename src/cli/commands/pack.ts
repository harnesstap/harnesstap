import type { Command } from "commander";
import { resolve } from "node:path";
import { packProject, PackError } from "../../services/apm-pack.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { formatCommand, isVerboseMode } from "../shared.js";

export interface PackCommandOpts {
  project?: string;
  output?: string;
  archive?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  format?: string;
}

export function handlePackCommand(opts: PackCommandOpts): void {
  const format = parseOutputFormat(opts.format);
  const verbose = Boolean(opts.verbose) || isVerboseMode();

  try {
    const result = packProject({
      projectRoot: resolve(opts.project ?? "."),
      outputDir: opts.output,
      archive: opts.archive,
      dryRun: opts.dryRun,
      verbose,
    });

    if (format === "json") {
      printJson({
        name: result.name,
        version: result.version,
        output: result.outputPath,
        archive: result.archive,
        dry_run: result.dryRun,
        file_count: result.fileCount,
        files: result.files,
        warnings: result.warnings,
      });
      return;
    }

    for (const warning of result.warnings) {
      ui.warn(warning);
    }
    if (verbose) {
      for (const file of result.files) {
        const remap = file.remappedFrom ? `  ← ${file.remappedFrom}` : "";
        console.log(`  ${file.path}${remap}`);
      }
    }

    const dest = result.dryRun ? `${result.outputPath} (dry run)` : result.outputPath;
    ui.success(`Packed ${result.fileCount} file(s) -> ${dest}`);
    console.log(
      ui.theme.muted(
        "Plugin bundle ready — contains plugin.json plus plugin-native directories (agents/, skills/, commands/, hooks/) and an embedded apm.lock.yaml for install-time integrity verification.",
      ),
    );
    ui.info(`Share with: ${formatCommand(`apply ${result.outputPath}`)}`);
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof PackError) {
      ui.danger(error.message, {
        hints: [formatCommand("config init"), formatCommand("apply")],
      });
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

export function registerPackCommand(root: Command): void {
  root
    .command("pack")
    .description(
      "Pack an apm.yml project into an Agent Plugins 1.0 bundle (plugin.json + primitives + apm.lock.yaml)",
    )
    .option("--project <path>", "Project directory", ".")
    .option("-o, --output <dir>", "Bundle output directory", "build")
    .option("--archive", "Write a .zip archive instead of a directory")
    .option("--dry-run", "Print what would be packed without writing")
    .option("--verbose", "List every packed file and remapping")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: PackCommandOpts) => {
      handlePackCommand(opts);
    });
}
