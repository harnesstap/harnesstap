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
import { maybePromptKeepUpToDate } from "./plugin-auto-update.js";
import { withUpstreamUpdateLock } from "../../services/upstream-update-lock.js";
import { runUpstreamCheck, type UpstreamCheckRow } from "../../services/upstream-check.js";
import { formatCount } from "../formatting.js";
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
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return "prompt";
  }
  return "require-yes";
}

function originRef(row: PluginOriginCheckRow): string {
  return row.origin_version ?? row.origin_fingerprint ?? "";
}

function upstreamAvailable(row: UpstreamCheckRow): string {
  if (row.status === "update") return row.latest_in_range;
  if (row.status === "major") return `${row.latest_major} (major)`;
  if (row.status === "unreachable" || row.status === "unpublished") return row.message;
  return "";
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
  // Same table the sidecar and Desktop read, so every surface agrees.
  const upstream = (await runUpstreamCheck(name ? { name } : undefined)).rows;

  if (format === "json") {
    printJson({ ...report, upstream });
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
      summary: formatCount(report.results.length, "plugin"),
      empty: "No syncable working heads.",
    });
    if (upstream.length > 0) {
      ui.table.print({
        columns: [
          { key: "name", header: "NAME", width: 18 },
          { key: "upstream", header: "UPSTREAM", width: 30 },
          { key: "status", header: "STATUS", width: 11 },
          { key: "local", header: "LOCAL", width: 8 },
          { key: "available", header: "AVAILABLE", width: 16 },
        ],
        rows: upstream.map((row) => ({
          name: row.plugin_name,
          upstream: row.ref,
          status: row.status,
          local: row.local_version,
          available: upstreamAvailable(row),
        })),
        summary: upstream.some((row) => row.status === "major")
          ? `${formatCount(upstream.length, "upstream link")}. A major version is never installed automatically.`
          : formatCount(upstream.length, "upstream link"),
      });
    }
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
  if (name && opts.all) {
    process.exitCode = 1;
    ui.danger("pass a name or --all, not both");
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
          message: `Update ${formatCount(count, "plugin")} from origin?`,
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
    // The Desktop sidecar may be checking or installing; wait for it.
    const report = await withUpstreamUpdateLock(
      () => updatePluginOrigins({ name, all: opts.all, force: opts.force }),
      {
        waitMs: UPDATE_LOCK_WAIT_MS,
        onWait: () => ui.info("Waiting for another plugin update to finish."),
      },
    );
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
    } else if (opts.all && format !== "json") {
      await maybePromptKeepUpToDate();
    }
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    ui.danger(message);
  }
}

const UPDATE_LOCK_WAIT_MS = 5 * 60 * 1000;

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
    summary: formatCount(rows.length, "plugin"),
    empty: "No plugins updated.",
  });
}
