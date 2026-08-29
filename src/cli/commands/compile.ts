import type { Command } from "commander";
import { resolve } from "node:path";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  compileApmProject,
  CompileError,
  resolveProjectCompileTargets,
} from "../../services/compile-apm.js";
import {
  previewApmTargets,
  TargetFlagError,
  TargetResolutionError,
} from "../../services/apm-targets.js";
import { printUnicodeGateWarnings } from "../../services/deploy-gate.js";
import { CliUsageError } from "../../services/cli-errors.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { formatCommand } from "../shared.js";
import { CriticalUnicodeError } from "../../services/unicode-scan.js";

export interface CompileCommandOpts {
  project?: string;
  target?: string;
  all?: boolean;
  harness?: string;
  dryRun?: boolean;
  force?: boolean;
  format?: string;
}

export interface TargetsCommandOpts {
  project?: string;
  json?: boolean;
  all?: boolean;
  format?: string;
}

function compileHints(): string[] {
  return [
    formatCommand("compile --target cursor"),
    formatCommand("targets"),
    "Declare targets: in apm.yml for portable compile/install",
  ];
}

export async function handleCompileCommand(opts: CompileCommandOpts): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(opts.project ?? ".");
  const format = parseOutputFormat(opts.format);

  try {
    const result = await compileApmProject({
      projectRoot,
      ...(opts.target ? { cliTarget: opts.target } : {}),
      ...(opts.all ? { cliAll: true } : {}),
      ...(opts.harness ? { cliHarness: opts.harness } : {}),
      dryRun: opts.dryRun,
      force: opts.force,
    });

    if (format === "human") {
      for (const warning of result.warnings) {
        ui.warn(warning);
      }
      printUnicodeGateWarnings(result.unicodeFindings, opts.force);
    }

    if (format === "json") {
      printJson({
        source: result.resolved.source,
        targets: result.resolved.canonicalTargets,
        harnesses: result.resolved.harnessTargets,
        dry_run: result.dryRun,
        warnings: result.warnings,
        platforms: result.generated.map((entry) => ({
          platform: entry.platformId,
          files: entry.files.map((file) => ({ path: file.path })),
        })),
        written_files: result.writtenFiles,
      });
      return;
    }

    if (result.resolved.harnessTargets.length === 0) {
      return;
    }

    const dryPrefix = result.dryRun ? `${ui.theme.muted("[dry run]")} ` : "";
    if (result.dryRun) {
      for (const entry of result.generated) {
        console.log(
          `${dryPrefix}${ui.theme.success(`${ui.icons.success} ${entry.platformId}`)} ${ui.icons.bullet} ${entry.files.length} file(s)`,
        );
        for (const file of entry.files) {
          console.log(ui.theme.muted(`  ${ui.icons.bullet} ${file.path}`));
        }
      }
      return;
    }

    ui.success(
      `${dryPrefix}Compiled ${result.resolved.canonicalTargets.join(", ") || result.resolved.harnessTargets.join(", ")} ${ui.icons.bullet} ${result.writtenFiles.length} file(s)`,
    );
    for (const file of result.writtenFiles) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${file}`));
    }
  } catch (error) {
    process.exitCode = error instanceof TargetFlagError ? 2 : 1;
    if (error instanceof TargetFlagError || error instanceof CliUsageError) {
      ui.danger(error.message, { hints: compileHints() });
      return;
    }
    if (error instanceof CompileError || error instanceof TargetResolutionError) {
      ui.danger(error.message, { hints: compileHints() });
      return;
    }
    if (error instanceof CriticalUnicodeError) {
      ui.danger(error.message, { hints: [formatCommand("compile --force")] });
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

export function handleTargetsCommand(opts: TargetsCommandOpts): void {
  const projectRoot = resolve(opts.project ?? ".");
  const format = opts.json ? "json" : parseOutputFormat(opts.format);

  try {
    const resolved = resolveProjectCompileTargets({
      projectRoot,
      mode: "compile",
    });
    const rows = previewApmTargets(resolved, { includeAgentSkills: Boolean(opts.all) });

    if (format === "json") {
      printJson({
        source: resolved.source,
        resolved: resolved.canonicalTargets,
        harnesses: resolved.harnessTargets,
        warnings: resolved.warnings,
        targets: rows,
      });
      return;
    }

    for (const warning of resolved.warnings) {
      ui.warn(warning);
    }

    console.log(
      ui.renderTable({
        columns: [
          { key: "target", header: "TARGET", width: 14 },
          { key: "status", header: "STATUS", width: 10 },
          { key: "source", header: "SOURCE", width: 36 },
          { key: "deployDir", header: "DEPLOY DIR", width: 12 },
        ],
        rows: rows.map((row) => ({
          target: row.target,
          status: row.status,
          source: row.source,
          deployDir: row.deployDir,
        })),
      }),
    );

    if (resolved.source === "empty") {
      ui.info("No target is active. Declare targets: in apm.yml or add a harness config directory.");
    }
  } catch (error) {
    process.exitCode = error instanceof TargetFlagError ? 2 : 1;
    if (error instanceof TargetFlagError || error instanceof CliUsageError) {
      ui.danger(error.message);
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

export function registerCompileCommand(root: Command): void {
  root
    .command("compile")
    .description("Compile local .apm/ primitives into resolved target harness directories")
    .option("--project <path>", "Project directory", ".")
    .option("-t, --target <slugs>", "Comma-separated APM target slugs (cursor, claude, …)")
    .option("--all", "Compile every canonical target (not antigravity or agent-skills)")
    .option("--harness <slugs>", "Comma-separated HarnessTap harness slugs (same slot as --target)")
    .option("--dry-run", "Show placement without writing files")
    .option("--force", "Override critical hidden-Unicode findings")
    .option("--format <mode>", "Output format: human or json", "human")
    .action(async (opts: CompileCommandOpts) => {
      await handleCompileCommand(opts);
    });
}

export function registerTargetsCommand(root: Command): void {
  root
    .command("targets")
    .description("Show which APM compile targets resolve for this project, and why")
    .option("--project <path>", "Project directory", ".")
    .option("--json", "Emit machine-readable JSON")
    .option("--all", "Include the agent-skills meta-target row")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: TargetsCommandOpts) => {
      handleTargetsCommand(opts);
    });
}
