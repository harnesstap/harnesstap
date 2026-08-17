import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  formatPluginVersionLabel,
  listPluginVersionHistory,
} from "../../services/plugin-versioning.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export function handlePluginVersionsCommand(
  name: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const versions = listPluginVersionHistory(name);
  if (versions.length === 0) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${name}`);
    return;
  }
  if (format === "json") {
    printJson({ versions });
    return;
  }
  ui.table.print({
    columns: [
      { key: "version", header: "VERSION", width: 12 },
      { key: "state", header: "STATE", width: 16 },
      { key: "frozen", header: "FROZEN", width: 24 },
    ],
    rows: versions.map((row) => ({
      version: formatPluginVersionLabel(row.version, row.dirty),
      state: row.is_head ? "Working head" : "Frozen",
      frozen: row.frozen_at ?? "",
    })),
  });
}
