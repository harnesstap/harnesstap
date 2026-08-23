import { resolve } from "node:path";
import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { COMMAND_HELP_REGISTRY } from "../../services/cli-help-registry.js";
import {
  addResourceTrackedDirectory,
  listResourceTrackedDirectories,
  removeResourceTrackedDirectory,
  rescanResourceTrackedDirectories,
  type ResourceTrackedDirectoryEntry,
} from "../../services/resource-tracked-directories.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { configureCommandGroup } from "../help.js";

function ensureLibraryDb(): void {
  initializeSchema(getDb());
}

function formatDirectoryCount(count: number): string {
  return `${count} tracked director${count === 1 ? "y" : "ies"}`;
}

function formatImportedCount(count: number): string {
  return `${count} resource${count === 1 ? "" : "s"} imported`;
}

function kindLabel(kind: ResourceTrackedDirectoryEntry["kind"]): string {
  switch (kind) {
    case "home_default":
      return "home";
    case "custom":
      return "custom";
    default: {
      const _exhaustive: never = kind;
      throw _exhaustive;
    }
  }
}

function platformsCell(platformIds: string[]): string {
  return platformIds.length > 0 ? platformIds.join(", ") : "—";
}

async function withCommandErrors(run: () => Promise<void>): Promise<void> {
  try {
    ensureLibraryDb();
    await run();
  } catch (error) {
    process.exitCode = 1;
    ui.danger(error instanceof Error ? error.message : String(error));
  }
}

function printResourceTrackedDirectoriesTable(
  directories: ResourceTrackedDirectoryEntry[],
): void {
  ui.table.print({
    columns: [
      { key: "path", header: "PATH", width: 40 },
      { key: "resources", header: "RESOURCES", width: 11 },
      { key: "folders", header: "FOLDERS", width: 9 },
      { key: "kind", header: "KIND", width: 8 },
      { key: "platforms", header: "PLATFORMS", width: 24 },
    ],
    rows: directories.map((entry) => ({
      path: entry.display_path ?? entry.path,
      resources: String(entry.resource_count),
      folders: String(entry.folders.length),
      kind: kindLabel(entry.kind),
      platforms: platformsCell(entry.platform_ids),
    })),
    summary: formatDirectoryCount(directories.length),
  });
}

export function printResourceTrackedDirectoriesList(): void {
  printResourceTrackedDirectoriesTable(listResourceTrackedDirectories());
}

async function handleList(opts: { format?: string }): Promise<void> {
  await withCommandErrors(async () => {
    const format = parseOutputFormat(opts.format);
    const directories = listResourceTrackedDirectories();
    if (format === "json") {
      printJson(directories);
      return;
    }
    printResourceTrackedDirectoriesTable(directories);
  });
}

async function handleAdd(path: string, opts: { format?: string }): Promise<void> {
  await withCommandErrors(async () => {
    const format = parseOutputFormat(opts.format);
    const result = await addResourceTrackedDirectory(path);
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(
      `Tracking ${result.directory.path} · ${formatImportedCount(result.imported_count)}`,
      { hint: "Rescan later with ht resource directories rescan." },
    );
  });
}

async function handleRemove(path: string, opts: { format?: string }): Promise<void> {
  await withCommandErrors(async () => {
    const format = parseOutputFormat(opts.format);
    const resolved = resolve(path);
    removeResourceTrackedDirectory(path);
    if (format === "json") {
      printJson({ removed: true, path: resolved });
      return;
    }
    ui.success(`Stopped tracking ${resolved}`, {
      hint: "Library resources from this path were not deleted.",
    });
  });
}

async function handleRescan(opts: { format?: string }): Promise<void> {
  await withCommandErrors(async () => {
    const format = parseOutputFormat(opts.format);
    const result = await rescanResourceTrackedDirectories();
    if (format === "json") {
      printJson(result);
      return;
    }
    for (const row of result.rescanned) {
      if (!row.skipped) {
        continue;
      }
      ui.warn(`${row.path} — ${row.error ?? "skipped"}`);
    }
    const dirCount = result.directories.length;
    ui.success(
      `Rescanned ${dirCount} director${dirCount === 1 ? "y" : "ies"} · ${formatImportedCount(result.imported_count)}`,
    );
  });
}

export function registerResourceDirectoriesCommand(resourceCmd: Command): void {
  const directoriesCmd = configureCommandGroup(
    resourceCmd
      .command("directories")
      .description("Manage directories scanned into the resource library"),
  );

  directoriesCmd
    .command("list")
    .alias("ls")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("List directories tracked for resource import")
    .action(handleList);

  COMMAND_HELP_REGISTRY["resource.directories.list"] = {
    description: "List directories tracked for resource import",
    examples: [
      "resource directories list",
      "resource directories list --format json",
    ],
  };

  directoriesCmd
    .command("add")
    .argument("<path>", "Directory to track and import")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Track a directory and import resources (skip existing)")
    .action(handleAdd);

  COMMAND_HELP_REGISTRY["resource.directories.add"] = {
    description: "Track a directory and import resources (skip existing)",
    examples: [
      "resource directories add ./my-project",
      "resource directories add ./my-project --format json",
    ],
  };

  directoriesCmd
    .command("remove")
    .alias("rm")
    .argument("<path>", "Tracked directory to stop watching")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Stop tracking a directory (library resources stay)")
    .action(handleRemove);

  COMMAND_HELP_REGISTRY["resource.directories.remove"] = {
    description: "Stop tracking a directory (library resources stay)",
    examples: [
      "resource directories remove ./my-project",
      "resource directories rm ./my-project --format json",
    ],
  };

  directoriesCmd
    .command("rescan")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Re-scan home defaults and every tracked directory")
    .action(handleRescan);

  COMMAND_HELP_REGISTRY["resource.directories.rescan"] = {
    description: "Re-scan home defaults and every tracked directory",
    examples: [
      "resource directories rescan",
      "resource directories rescan --format json",
    ],
  };
}
