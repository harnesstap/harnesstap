import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { listOriginUpdateCandidates } from "../../services/plugin-origin-locator.js";
import {
  checkPluginOrigins,
  updatePluginOrigins,
  type PluginOriginCheckRow,
  type PluginOriginUpdateRow,
} from "../../services/plugin-origin-update.js";
import {
  isPromptCancellationError,
  promptForConfirmation,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

function originUpdateConfirmMode(yes?: boolean): "skip" | "prompt" | "require-yes" {
  if (yes) {
    return "skip";
  }
  if (
    process.argv.includes("--no-interactive")
    || process.env.HARNESSTAP_NO_INTERACTIVE === "1"
  ) {
    return "require-yes";
  }
  const ciValue = process.env.CI?.trim().toLowerCase();
  const ciEnabled = Boolean(
    ciValue && ciValue !== "0" && ciValue !== "false" && ciValue !== "no",
  );
  if (ciEnabled) {
    return "require-yes";
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return "prompt";
  }
  return "require-yes";
}

function originRef(row: PluginOriginCheckRow): string {
  return row.origin_version ?? row.origin_fingerprint ?? "";
}

export async function handlePluginCheckCommand(
  name: string | undefined,
  opts: { refresh?: boolean; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const report = await checkPluginOrigins({
    name,
    refresh: opts.refresh,
  });

  if (format === "json") {
    printJson(report);
  } else {
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 22 },
        { key: "origin", header: "ORIGIN", width: 28 },
        { key: "status", header: "STATUS", width: 12 },
        { key: "local", header: "LOCAL", width: 12 },
        { key: "originRef", header: "ORIGIN REF", width: 16 },
      ],
      rows: report.results.map((row) => ({
        name: row.name,
        origin: row.origin_locator,
        status: row.status,
        local: row.local_version,
        originRef: originRef(row),
      })),
      summary: `${report.results.length} plugin${report.results.length === 1 ? "" : "s"}`,
      empty: "No syncable working heads.",
    });
  }

  if (report.results.some((row) => row.status === "error")) {
    process.exitCode = 1;
  }
}

export async function handlePluginUpdateCommand(
  name: string | undefined,
  opts: {
    all?: boolean;
    force?: boolean;
    yes?: boolean;
    format?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  if (!name && !opts.all) {
    process.exitCode = 1;
    ui.danger("pass a name or --all");
    return;
  }

  if (opts.all) {
    const mode = originUpdateConfirmMode(opts.yes);
    if (mode === "require-yes") {
      process.exitCode = 1;
      ui.danger("Pass --yes to update without a prompt.");
      return;
    }
    if (mode === "prompt") {
      const count = listOriginUpdateCandidates().length;
      try {
        const confirmed = await promptForConfirmation({
          message: `Update ${count} plugins from origin?`,
          default: false,
        });
        if (!confirmed) {
          ui.info("Operation cancelled.");
          return;
        }
      } catch (error) {
        if (isPromptCancellationError(error)) {
          ui.info("Operation cancelled.");
          return;
        }
        throw error;
      }
    }
  }

  try {
    const report = await updatePluginOrigins({
      name,
      all: opts.all,
      force: opts.force,
    });
    if (format === "json") {
      printJson(report);
    } else {
      printUpdateHuman(report.results);
      ui.info(
        `${report.summary.updated} updated ${ui.icons.bullet} ${report.summary.skipped} skipped ${ui.icons.bullet} ${report.summary.failed} failed`,
      );
    }
    if (report.results.some((row) => row.status === "failed")) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    ui.danger(message);
  }
}

function printUpdateHuman(rows: PluginOriginUpdateRow[]): void {
  ui.table.print({
    columns: [
      { key: "name", header: "NAME", width: 22 },
      { key: "status", header: "STATUS", width: 12 },
      { key: "version", header: "LOCAL", width: 12 },
      { key: "message", header: "MESSAGE", width: 40 },
    ],
    rows: rows.map((row) => ({
      name: row.name,
      status: row.status,
      version: row.local_version ?? "",
      message: row.message ?? "",
    })),
    summary: `${rows.length} plugin${rows.length === 1 ? "" : "s"}`,
    empty: "No plugins updated.",
  });
}
