import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getHarnesstapDir } from "../../db/connection.js";
import { exportSbom, LockExportError, parseSbomFormat } from "../../services/export/sbom.js";
import {
  LockExportTimestampError,
  resolveExportTimestamp,
} from "../../services/export/timestamp.js";
import { APM_LOCKFILE_FILENAME, lockfilePath, readLockfile } from "../../services/lockfile.js";
import { ui } from "../../ui/index.js";
import { configureCommandGroup } from "../help.js";
import { formatCommand } from "../shared.js";

export interface LockExportOpts {
  format?: string;
  output?: string;
  project?: string;
  global?: boolean;
  timestamp?: string;
}

export class LockExportUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockExportUsageError";
  }
}

function resolveLockRoot(opts: LockExportOpts): string {
  if (opts.global && opts.project !== undefined && opts.project !== ".") {
    throw new LockExportUsageError("Pass only one of --global or --project.");
  }
  if (opts.global) {
    return getHarnesstapDir();
  }
  return resolve(opts.project ?? ".");
}

export function handleLockExportCommand(opts: LockExportOpts): void {
  try {
    const projectRoot = resolveLockRoot(opts);
    const lock = readLockfile(projectRoot);
    if (!lock) {
      throw new LockExportUsageError(
        `No lockfile found at ${lockfilePath(projectRoot)}. Run ${formatCommand("apply")} or ${formatCommand("install")} to generate one first.`,
      );
    }

    const format = parseSbomFormat(opts.format);
    const timestamp = resolveExportTimestamp(opts.timestamp, lock.resolved_at);
    const document = exportSbom(lock, format, timestamp);

    if (opts.output) {
      const outputPath = resolve(opts.output);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, document, "utf8");
      return;
    }

    process.stdout.write(document);
  } catch (error) {
    process.exitCode = 1;
    if (
      error instanceof LockExportUsageError
      || error instanceof LockExportError
      || error instanceof LockExportTimestampError
    ) {
      ui.danger(error.message, {
        hints: [formatCommand("apply"), formatCommand("install")],
      });
      return;
    }
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

export function registerLockCommands(root: Command): void {
  const lockCmd = configureCommandGroup(
    root.command("lock").description("Read apm.lock.yaml and export inventory artifacts"),
  );

  lockCmd
    .command("export")
    .description(
      "Export a CycloneDX or SPDX SBOM inventory from the existing lockfile (no re-resolve)",
    )
    .option(
      "-f, --format <format>",
      "SBOM output format: cyclonedx (1.5) or spdx (2.3)",
      "cyclonedx",
    )
    .option("-o, --output <file>", "Write the SBOM to a file instead of stdout")
    .option("--project <path>", "Project directory", ".")
    .option("-g, --global", `Read ${APM_LOCKFILE_FILENAME} from ~/.harnesstap/`)
    .option(
      "--timestamp <ts>",
      "Pin the SBOM timestamp (timezone-aware ISO 8601) for reproducible output",
    )
    .action((exportOpts: LockExportOpts) => {
      handleLockExportCommand(exportOpts);
    });
}
