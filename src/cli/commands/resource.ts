import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  deleteResource,
  listResources,
  resolveResource,
} from "../../models/resource.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { printResourceShow } from "../../services/resource-show.js";
import { syncLinkedResources } from "../../services/resource-sync.js";
import { runResourceDeleteWizard } from "../../services/wizards/resource-delete.js";
import { runResourceListWizard } from "../../services/wizards/resource-list.js";
import { runResourceShowWizard } from "../../services/wizards/resource-show.js";
import {
  isPromptCancellationError,
  resolveOrPrompt,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import { RESOURCE_TYPES } from "../../types.js";
import { ui } from "../../ui/index.js";
import {
  renderFlatResourceListTable,
  renderGroupedResourceListTables,
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "../../ui/resource-list-render.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { makeIdColumn } from "../columns.js";
import {
  makeResourceTypeColumn,
  resourceListRenderOptions,
  resolveResourceListType,
  shouldUseInteractiveResourceList,
} from "../handlers/resource-list.js";
import { configureCommandGroup } from "../help.js";
import { renderCliError } from "../runtime.js";
import { formatCommand } from "../shared.js";

async function deleteLibraryResource(selector: string): Promise<void> {
  const result = resolveResource(selector);
  if (result.status === "not_found") {
    ui.danger(`Resource not found: ${selector}`);
    return;
  }
  if (result.status === "ambiguous") {
    ui.danger(`Ambiguous resource name: ${selector}`);
    for (const match of result.matches) {
      ui.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
    }
    return;
  }
  if (deleteResource(result.resource.id)) {
    ui.success(`Deleted ${result.resource.type} ${ui.theme.accent(`"${result.resource.name}"`)}`);
    return;
  }
  ui.danger(`Resource not found: ${selector}`);
}

async function handleResourceListCommand(
  positionalType: string | undefined,
  opts: {
    type?: string;
    search?: string;
    format?: string;
    showId?: boolean;
    all?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const resolvedType = resolveResourceListType(positionalType, opts.type);
  if (resolvedType === "conflict") {
    ui.danger(`Conflicting type filters: ${positionalType} and ${opts.type}`);
    return;
  }
  if (resolvedType === "invalid") {
    ui.danger(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
    return;
  }

  let search = opts.search;
  if (shouldUseInteractiveResourceList(opts)) {
    try {
      while (true) {
        const wizardResult = await runResourceListWizard({
          type: resolvedType,
          search,
          ...resourceListRenderOptions(opts),
        });
        if (!wizardResult) {
          break;
        }

        switch (wizardResult.action) {
          case "delete":
            await deleteLibraryResource(wizardResult.name);
            search = undefined;
            continue;
          case "filter":
            search = wizardResult.query.length > 0 ? wizardResult.query : undefined;
            break;
          case "edit":
            search = undefined;
            continue;
          default: {
            const _exhaustive: never = wizardResult;
            throw _exhaustive;
          }
        }
        break;
      }
    } catch (error) {
      if (isPromptCancellationError(error)) {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  const listed = listResources({ type: resolvedType, search });
  const sortedResources = sortResourcesByUpdatedAt(toResourceListRows(listed));

  if (format === "json") {
    printJson(sortedResources);
    return;
  }

  if (sortedResources.length === 0) {
    console.log(
      `No resources found.\n  → Run \`${formatCommand("scan")}\` to import some.`,
    );
    return;
  }

  const renderOpts = resourceListRenderOptions(opts);

  if (resolvedType) {
    console.log(renderFlatResourceListTable(sortedResources, renderOpts));
    return;
  }

  console.log(renderGroupedResourceListTables(sortedResources, renderOpts));
}

export function registerResourceCommands(root: Command): void {
  const resourceCmd = configureCommandGroup(
    root
      .command("resource")
      .alias("r")
      .description("Manage resources (individual pieces of AI configuration like agents, skills, or instructions)"),
  );

  resourceCmd
    .command("list")
    .alias("ls")
    .argument("[type]", `Filter by resource type (${RESOURCE_TYPES.join(", ")})`)
    .option("-t, --type <type>", "Filter by resource type")
    .option("-s, --search <query>", "Search by name or description (skips interactive filter)")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--show-id", "Show IDs in human-readable tables")
    .option("--all", "Show all resources per type (default: first 10 per type)")
    .description("List imported resources, optionally filtered by type or search")
    .action(async (
      type: string | undefined,
      opts: {
        type?: string;
        search?: string;
        format?: string;
        showId?: boolean;
        all?: boolean;
        noInteractive?: boolean;
      },
    ) => {
      try {
        await handleResourceListCommand(type, opts);
      } catch (error) {
        process.exitCode = 1;
        ui.danger(error instanceof Error ? error.message : String(error));
      }
    });

  resourceCmd
    .command("show")
    .argument("[resource]", "Resource name or ID")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--show-id", "Show IDs in list-oriented human tables")
    .option("--all-fields", "Show all resource metadata fields")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .description("Show a resource by name, selector, or ULID")
    .action(async (
      resource: string | undefined,
      opts: {
        format?: string;
        showId?: boolean;
        allFields?: boolean;
        interactive?: boolean;
        noInteractive?: boolean;
      },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const format = parseOutputFormat(opts.format);
      const resolvedResource = await resolveOrPrompt({
        value: resource,
        shouldPrompt: shouldUseWizard({
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format,
          missingRequiredArgs: !resource,
        }),
        prompt: async () => runResourceShowWizard(),
      });
      if (!resolvedResource) {
        process.exitCode = 1;
        ui.danger(
          listResources().length > 0
            ? "error: missing required argument 'resource'"
            : `No resources found. Scan or import resources first (e.g. \`${formatCommand("init")}\`).`,
        );
        return;
      }
      const result = resolveResource(resolvedResource);
      if (result.status === "ambiguous" && format === "json") {
        printJson({
          error: "ambiguous_resource_name",
          input: resolvedResource,
          matches: result.matches,
        });
        return;
      }
      if (result.status === "found" && format === "json") {
        printJson(result.resource);
        return;
      }
      if (result.status === "not_found") {
        ui.danger(`Resource not found: ${resolvedResource}`);
        return;
      }
      if (result.status === "ambiguous") {
        ui.danger(`Ambiguous resource selector: ${resolvedResource}`);
        ui.table.print({
          columns: [
            ...makeIdColumn(Boolean(opts.showId)),
            makeResourceTypeColumn(),
            { key: "name", header: "NAME", width: 26 },
          ],
          rows: result.matches,
        });
        process.exitCode = 1;
        return;
      }
      printResourceShow(result.resource, { showAllFields: Boolean(opts.allFields) });
    });

  resourceCmd
    .command("sync")
    .argument("[selector]", "Linked resource selector (optional)")
    .option("--overwrite", "Overwrite cached definitions when install tree differs")
    .option("--on-conflict <policy>", "Conflict policy: overwrite, ignore, or fail", "fail")
    .option("--force", "Sync pinned resources")
    .option("--dry-run", "Report linked resources without writing changes")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Sync plugin resources and marketplace-linked definitions from install trees")
    .action(async (selector: string | undefined, opts: { overwrite?: boolean; onConflict?: string; force?: boolean; dryRun?: boolean; format?: string }) => {
      const db = getDb();
      initializeSchema(db);
      const format = parseOutputFormat(opts.format);
      const onConflict = opts.onConflict as "overwrite" | "ignore" | "fail" | undefined;
      if (onConflict && !["overwrite", "ignore", "fail"].includes(onConflict)) {
        process.exitCode = 1;
        ui.danger("Invalid --on-conflict. Use overwrite, ignore, or fail.");
        return;
      }
      const result = await syncLinkedResources({
        selector,
        policy: opts.overwrite ? "overwrite" : "skip",
        onConflict: onConflict ?? (opts.overwrite ? "overwrite" : "fail"),
        force: opts.force,
        dryRun: opts.dryRun,
      });

      if (format === "json") {
        printJson(result);
        return;
      }

      ui.success(
        `Checked ${result.checked} resource(s) ${ui.icons.bullet} ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped, ${result.stale.length} stale`,
      );
      for (const entry of result.stale) {
        ui.warn(`${entry.resource.type}:${entry.resource.name} — ${entry.reason}`);
      }
    });

  resourceCmd
    .command("delete")
    .argument("[resource]", "Resource name or ID")
    .option("-s, --search <query>", "Filter resources in the delete wizard")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Delete a resource from the library")
    .action(async (resource: string | undefined, opts: { search?: string; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
      const db = getDb();
      initializeSchema(db);
      const useWizard = shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      });
      const selectors = resource
        ? [resource]
        : useWizard
          ? await runResourceDeleteWizard({ search: opts.search })
          : [];

      if (selectors.length === 0) {
        process.exitCode = 1;
        if (!resource && useWizard) {
          ui.danger("No resources selected for deletion");
        } else {
          renderCliError(missingRequiredArg("resource", "resource delete"));
        }
        return;
      }

      for (const resolvedResource of selectors) {
        const result = resolveResource(resolvedResource);
        if (result.status === "not_found") {
          ui.danger(`Resource not found: ${resolvedResource}`);
          return;
        }
        if (result.status === "ambiguous") {
          ui.danger(`Ambiguous resource name: ${resolvedResource}`);
          for (const match of result.matches) {
            ui.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
          }
          return;
        }
        if (deleteResource(result.resource.id)) {
          ui.success(`Deleted ${result.resource.type} ${ui.theme.accent(`"${result.resource.name}"`)}`);
        } else {
          ui.danger(`Resource not found: ${resolvedResource}`);
        }
      }
    });
}
