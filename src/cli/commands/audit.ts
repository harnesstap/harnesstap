import type { Command } from "commander";
import { resolve } from "node:path";
import {
  AuditUsageError,
  auditProject,
  type AuditResult,
} from "../../services/audit.js";
import { formatUnicodeFinding } from "../../services/unicode-scan.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { formatCommand } from "../shared.js";

export interface AuditCommandOpts {
  project?: string;
  file?: string;
  ci?: boolean;
  strip?: boolean;
  dryRun?: boolean;
  format?: string;
}

function printHuman(result: AuditResult, opts: AuditCommandOpts): void {
  for (const finding of result.findings) {
    if (finding.severity === "info") continue;
    const line = formatUnicodeFinding(finding);
    if (finding.severity === "critical") {
      ui.danger(line);
    } else {
      ui.warn(line);
    }
  }

  for (const issue of result.integrity.issues) {
    switch (issue.kind) {
      case "missing":
        ui.danger(`missing ${issue.path}`);
        break;
      case "extra":
        ui.danger(`extra ${issue.path}`);
        break;
      case "mismatch":
        ui.danger(`hash mismatch ${issue.path}`);
        break;
      case "unsafe-path":
        ui.danger(`unsafe path ${issue.path}`);
        break;
      default: {
        const unhandled: never = issue.kind;
        ui.danger(`integrity ${String(unhandled)} ${issue.path}`);
      }
    }
  }

  if (opts.strip) {
    const verb = opts.dryRun ? "Would strip" : "Stripped";
    for (const entry of result.stripped) {
      ui.info(`${verb} ${entry.removed} character(s) from ${entry.path}`);
    }
    if (result.stripped.length === 0) {
      ui.info(`${opts.dryRun ? "Would strip" : "Stripped"} nothing`);
    }
  }

  const { critical, warning, info } = result.summary;
  const parts = [`${critical} critical`, `${warning} warning`, `${info} info`];
  const integrityNote = opts.ci
    ? result.integrity.ok
      ? "integrity ok"
      : `${result.integrity.issues.length} integrity issue(s)`
    : undefined;
  const summary = integrityNote
    ? `Scanned ${result.scannedFiles.length} file(s): ${parts.join(", ")}; ${integrityNote}`
    : `Scanned ${result.scannedFiles.length} file(s): ${parts.join(", ")}`;
  if (result.exitCode === 0) {
    ui.success(summary);
  } else if (result.exitCode === 2) {
    ui.warn(summary);
  } else {
    ui.danger(summary);
  }
}

export function handleAuditCommand(opts: AuditCommandOpts): void {
  const format = parseOutputFormat(opts.format);

  try {
    const result = auditProject({
      projectRoot: resolve(opts.project ?? "."),
      file: opts.file,
      ci: opts.ci,
      strip: opts.strip,
      dryRun: opts.dryRun,
    });

    process.exitCode = result.exitCode;

    if (format === "json") {
      printJson({
        passed: result.exitCode === 0,
        summary: result.summary,
        findings: result.findings,
        integrity: result.integrity,
        stripped: result.stripped,
        scanned_files: result.scannedFiles,
        exit_code: result.exitCode,
      });
      return;
    }

    printHuman(result, opts);
  } catch (error) {
    process.exitCode = error instanceof AuditUsageError ? 2 : 1;
    if (error instanceof AuditUsageError) {
      ui.danger(error.message, {
        hints: [formatCommand("audit --help")],
      });
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

export function registerAuditCommand(root: Command): void {
  root
    .command("audit")
    .description(
      "Scan a project for hidden Unicode and verify lockfile SHA-256 hashes",
    )
    .option("--project <path>", "Project directory", ".")
    .option("--file <path>", "Scan a single file instead of the project")
    .option("--ci", "CI gate: fail on critical Unicode or lockfile hash drift")
    .option("--strip", "Remove critical and warning hidden-Unicode characters")
    .option("--dry-run", "Preview --strip without writing")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: AuditCommandOpts) => {
      handleAuditCommand(opts);
    });
}
