import { resolve } from "node:path";
import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import type { ImportConflictPolicy } from "../../models/resource.js";
import { getProject, getProjectByOrigin, upsertProject } from "../../models/project.js";
import { listImportedSnapshots } from "../../models/imported-snapshot.js";
import { getSnapshot, listSnapshots } from "../../models/snapshot.js";
import type { ImportedSnapshot, Resource } from "../../types.js";
import {
  applyImportedSnapshotToGlobal,
  generateFiles,
  materializeFiles,
  writeFiles,
} from "../../services/applier.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "../../services/git.js";
import { detectProjectDriftFromLatest } from "../../services/project-drift.js";
import { buildProjectStatusPayload } from "../../services/project-status-payload.js";
import { scanPluginSource } from "../../services/plugin-source-import.js";
import { syncProject, type ProjectReferenceStrategy } from "../../services/project-sync.js";
import { resolveScanGlobalHarnessTargets } from "../../services/harness-targets.js";
import {
  type ScanResult,
  type persistScanResults,
  applyScanConflicts,
  detectPlatforms,
  hasSharedProjectResourceFiles,
  isPluginSourcePath,
  scanProjectWithPluginSource,
  persistMergedProjectScan,
  scanAndPersistPluginSource,
  type PersistedPluginSourceResults,
} from "../../services/scanner.js";
import { dropHarnessSkillsDuplicatingPluginSource } from "../../services/scan-dedup.js";
import { handleUseCommand } from "../../services/use-command.js";
import { promptForChoice } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import {
  projectStatusPayloadToJson,
  renderProjectStatusHuman,
} from "../../ui/project-status-render.js";
import { createProgress } from "../../ui/progress.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { makeIdColumn } from "../columns.js";
import { formatCount } from "../formatting.js";
import { formatCommand, reportNoGitOrigin } from "../shared.js";

function resolveScanConflictPolicy(opts: {
  overwrite?: boolean;
  skipExisting?: boolean;
  noInteractive?: boolean;
}): ImportConflictPolicy {
  if (opts.overwrite) return "overwrite";
  if (opts.skipExisting) return "skip";
  if (opts.noInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    return "fail";
  }
  return "prompt";
}

function parseReferenceStrategy(
  value: string | undefined,
): ProjectReferenceStrategy {
  const strategy = value ?? "main";
  switch (strategy) {
    case "main":
    case "plugin":
    case "agents":
    case "auto":
      return strategy;
    default:
      throw new Error(
        `Invalid --reference value: ${value}. Expected main, plugin, agents, or auto.`,
      );
  }
}

function printProjectScanResults(
  results: ScanResult[],
  options: { dryRun?: boolean; importedCounts?: Map<string, number> } = {},
): void {
  for (const result of results) {
    if (result.resources.length === 0) continue;

    const count = options.dryRun
      ? result.resources.length
      : (options.importedCounts?.get(result.platformId) ?? result.resources.length);
    const prefix = options.dryRun ? ui.theme.muted("[dry run] ") : "";
    const verdict = ui.theme.success(
      `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${formatCount(count, "resource")}`,
    );
    console.log(prefix + verdict);
    for (const resource of result.resources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
    }
  }
}

function printPluginScanDryRun(
  imports: Awaited<ReturnType<typeof scanPluginSource>>,
): void {
  for (const result of imports) {
    const count = result.resources.length;
    const dryTag = ui.theme.muted("[dry run] ");
    const verdict = ui.theme.success(
      `${ui.icons.success} ${result.plugin_name} ${ui.icons.bullet} ${formatCount(count, "resource")}`,
    );
    console.log(dryTag + verdict);
    for (const resource of result.resources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
    }
  }
}

async function promptScanConflicts(
  conflicts: Awaited<ReturnType<typeof persistScanResults>>["conflicts"],
): Promise<"overwrite" | "skip" | "cancel"> {
  if (conflicts.length === 0) return "skip";
  ui.warn(`${conflicts.length} resource(s) differ from the library snapshot.`);
  for (const conflict of conflicts) {
    ui.dim(
      `  ${conflict.incoming.type}:${conflict.incoming.name} (${conflict.platformId})`,
    );
  }
  return promptForChoice({
    message: "How should HarnessTap handle these conflicts?",
    choices: [
      { name: "Overwrite library copies", value: "overwrite" as const },
      { name: "Keep existing library copies", value: "skip" as const },
      { name: "Cancel scan", value: "cancel" as const },
    ],
  });
}

function listRelatedImportedSnapshotIds(snapshot: ImportedSnapshot): string[] {
  return listImportedSnapshots()
    .filter((candidate) =>
      candidate.id !== snapshot.id &&
      candidate.source_kind === snapshot.source_kind &&
      candidate.source_label === snapshot.source_label &&
      candidate.plugin_name === snapshot.plugin_name,
    )
    .map((candidate) => candidate.id);
}

async function preflightImportedGlobalInstall(
  persisted: PersistedPluginSourceResults,
  harnessTargets: string[],
  homeRoot: string,
): Promise<void> {
  const resourcesById = new Map(persisted.resources.map((resource) => [resource.id, resource]));
  const plannedPaths = new Map<string, string>();

  for (const snapshot of persisted.snapshots) {
    const resources = snapshot.resource_ids.map((id) => resourcesById.get(id)).filter(
      (resource): resource is Resource => Boolean(resource),
    );
    if (resources.length !== snapshot.resource_ids.length) {
      throw new Error(`Imported snapshot ${snapshot.id} is missing one or more resources`);
    }

    const results = await generateFiles(resources, harnessTargets, homeRoot, {
      target: "global",
    });
    const files = results.flatMap((result) => result.files);

    for (const file of files) {
      const existingSnapshotId = plannedPaths.get(file.path);
      if (existingSnapshotId && existingSnapshotId !== snapshot.id) {
        throw new Error(
          `Global install cancelled for ${snapshot.plugin_name}; resolve conflicts and retry.`,
        );
      }
      plannedPaths.set(file.path, snapshot.id);
    }

    const preflight = await materializeFiles(files, homeRoot, {
      conflictPolicy: "prompt",
      currentSnapshotId: snapshot.id,
      replaceOwnedSnapshotIds: listRelatedImportedSnapshotIds(snapshot),
      dryRun: true,
    });
    if (preflight.cancelled) {
      throw new Error(
        `Global install cancelled for ${snapshot.plugin_name}; resolve conflicts and retry.`,
      );
    }
  }
}

async function handleScanCommand(
  path: string,
  opts: {
    dryRun?: boolean;
    global?: boolean;
    harness?: string;
    overwrite?: boolean;
    skipExisting?: boolean;
    namespace?: string;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);
  const detected = detectPlatforms(projectRoot);
  const hasHarnessSignals =
    detected.length > 0 || hasSharedProjectResourceFiles(projectRoot);
  const pluginSourcePath = !hasHarnessSignals && isPluginSourcePath(projectRoot);
  const scanHarnessFilter = opts.global ? undefined : opts.harness;

  if (pluginSourcePath && opts.harness && !opts.global) {
    throw new Error("--harness without --global is not supported when scanning a plugin source");
  }

  if (pluginSourcePath) {
    if (opts.dryRun) {
      if (opts.global) {
        ui.warn("--global is ignored with --dry-run");
      }
      const imports = await scanPluginSource(projectRoot);
      for (const result of imports) {
        const count = result.resources.length;
        const dryTag = ui.theme.muted("[dry run] ");
        const verdict = ui.theme.success(
          `${ui.icons.success} ${result.plugin_name} ${ui.icons.bullet} ${formatCount(count, "resource")}`,
        );
        console.log(dryTag + verdict);
        for (const resource of result.resources) {
          console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
        }
      }
      return;
    }

    const spin = createProgress("Scanning…");
    const persisted = await scanAndPersistPluginSource(projectRoot);
    spin.stop();

    for (const result of persisted.imports) {
      ui.success(`${result.plugin_name} ${ui.icons.bullet} ${formatCount(result.resources.length, "resource")}`);
      for (const resource of result.resources) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
      }
    }

    if (!opts.global) {
      return;
    }

    const homeRoot = resolveHomeRoot();
    const harnessTargets = resolveScanGlobalHarnessTargets(opts.harness, homeRoot);
    await preflightImportedGlobalInstall(persisted, harnessTargets, homeRoot);

    for (const snapshot of persisted.snapshots) {
      const install = await applyImportedSnapshotToGlobal(
        snapshot.id,
        harnessTargets,
        homeRoot,
      );
      if (install.cancelled) {
        throw new Error(
          `Global install cancelled for ${snapshot.plugin_name}; resolve conflicts and retry.`,
        );
      }
      ui.success(
        `Installed ${snapshot.plugin_name} globally to ${harnessTargets.join(", ")} ${ui.icons.bullet} ${formatCount(install.writtenFiles.length, "file")}`,
      );
    }

    return;
  }

  if (opts.global) {
    throw new Error("--global is only supported when scanning a plugin source");
  }

  if (!hasHarnessSignals && !isPluginSourcePath(projectRoot)) {
    ui.warn(`No harness resources found in this directory (${projectRoot}).`);
    ui.hint(
      `If you need to scan your global harness configuration, use \`${formatCommand("harness init")}\`.`,
    );
    return;
  }
  if (opts.dryRun) {
    const { harness: rawHarness, plugin } = await scanProjectWithPluginSource(
      projectRoot,
      scanHarnessFilter,
    );
    const harness = dropHarnessSkillsDuplicatingPluginSource(rawHarness, plugin);
    printProjectScanResults(harness, { dryRun: true });
    if (plugin.length > 0) {
      printPluginScanDryRun(plugin);
    }
    return;
  }

  const spin = createProgress("Scanning…");
  const conflictPolicy = resolveScanConflictPolicy(opts);
  const merged = await persistMergedProjectScan(projectRoot, scanHarnessFilter, {
    conflictPolicy,
    namespace: opts.namespace ?? "",
    originRef: projectRoot,
  });
  spin.stop();

  let harnessPersisted = merged.harness;
  if (harnessPersisted.conflicts.length > 0 && conflictPolicy === "prompt") {
    const resolution = await promptScanConflicts(harnessPersisted.conflicts);
    if (resolution === "cancel") {
      throw new Error("Scan cancelled due to resource conflicts.");
    }
    const resolved = applyScanConflicts(harnessPersisted.conflicts, resolution);
    harnessPersisted = {
      ...harnessPersisted,
      resources: [...harnessPersisted.resources, ...resolved],
      conflicts: [],
    };
  } else if (harnessPersisted.conflicts.length > 0) {
    throw new Error(
      `${harnessPersisted.conflicts.length} resource conflict(s). Use --overwrite or --skip-existing.`,
    );
  }

  printProjectScanResults(merged.scan.harness, {
    importedCounts: harnessPersisted.importedCounts,
  });

  if (merged.scan.plugin.length > 0) {
    for (const result of merged.scan.plugin) {
      ui.success(`${result.plugin_name} ${ui.icons.bullet} ${formatCount(result.resources.length, "resource")}`);
      for (const resource of result.resources) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
      }
    }
  }

  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    return;
  }

  const normalized = normalizeGitUrl(gitOrigin);
  const name = projectNameFromUrl(gitOrigin);
  const existingProject = getProjectByOrigin(normalized);
  upsertProject({
    git_origin: normalized,
    name,
    local_path: projectRoot,
  });

  if (!existingProject) {
    console.log("");
    ui.success(`Project linked: ${name}`);
    ui.hint(
      "Enables apply snapshots, drift checks (status --check), history, and revert for this repository.",
    );
  } else if (resolve(existingProject.local_path) !== resolve(projectRoot)) {
    ui.hint(`Updated local path for ${name}.`);
  }
}

function handleHistoryCommand(
  path: string,
  opts: { format?: string; showId?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    reportNoGitOrigin(formatCommand("history"));
    return;
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    if (format === "json") {
      printJson({ snapshots: [] });
      return;
    }
    ui.warn(`No project record found. Run \`${formatCommand("scan")}\` first.`);
    return;
  }
  const snapshots = listSnapshots(project.id);
  if (snapshots.length === 0) {
    if (format === "json") {
      printJson({ snapshots: [] });
      return;
    }
    ui.dim("No snapshots found.");
    return;
  }
  if (format === "json") {
    printJson(
      snapshots.map((snapshot) => ({
        id: snapshot.id,
        created_at: snapshot.created_at,
        label: snapshot.label,
      })),
    );
    return;
  }
  const showId = Boolean(opts.showId);
  const rows = snapshots.map((s) => ({
    when: s.created_at,
    id: s.id,
    label: s.label ?? "",
  }));
  ui.table.print({
    columns: [
      { key: "when", header: "WHEN", width: 16, transform: (value) => ui.format.formatRelativeTime(String(value)) },
      ...makeIdColumn(showId, 14),
      { key: "label", header: "LABEL", width: showId ? 36 : 50 },
    ],
    rows,
    summary: `${rows.length} snapshots`,
  });
}

function handleRevertCommand(snapshotId?: string): void {
  const db = getDb();
  initializeSchema(db);
  if (!snapshotId) {
    process.exitCode = 1;
    ui.danger(
      `Please provide a snapshot ID. Use \`${formatCommand("history --show-id")}\` or \`${formatCommand("history --format json")}\` to list them.`,
    );
    return;
  }
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    process.exitCode = 1;
    ui.danger(`Snapshot not found: ${snapshotId}`);
    return;
  }
  const project = getProject(snapshot.project_id);
  if (!project) {
    process.exitCode = 1;
    ui.danger("Snapshot project not found.");
    return;
  }
  const files = Object.entries(snapshot.state.platform_files).flatMap(
    ([, platformFiles]) =>
      Object.entries(platformFiles).map(([path, content]) => ({
        path,
        content,
      })),
  );
  writeFiles(files, project.local_path);
  ui.success(
    `Restored ${formatCount(files.length, "file")} from snapshot ${ui.theme.muted(ui.format.shortenId(snapshot.id))} (${ui.format.formatRelativeTime(snapshot.created_at)})`,
  );
}

async function handleProjectStatusCommand(
  path: string,
  opts: { format?: string; check?: boolean },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);

  if (opts.check) {
    const gitOrigin = getGitOrigin(projectRoot);
    if (!gitOrigin) {
      reportNoGitOrigin(formatCommand("status --check"));
      return;
    }
    const normalizedOrigin = normalizeGitUrl(gitOrigin);
    const project = getProjectByOrigin(normalizedOrigin);
    if (!project) {
      if (format === "json") {
        printJson({
          project_root: projectRoot,
          snapshot_id: null,
          has_drift: false,
          changes: [],
          message: `No project record. Run ${formatCommand("plugin apply")} first.`,
        });
        return;
      }
      ui.warn(`No project record found. Run \`${formatCommand("plugin apply")}\` first.`);
      return;
    }

    const report = detectProjectDriftFromLatest(projectRoot, project.id);
    if (!report) {
      return;
    }

    const statusPayload = await buildProjectStatusPayload(projectRoot);
    const lockDrift = statusPayload.lock?.drift === true;
    const hasDrift = report.has_drift || lockDrift;

    if (format === "json") {
      printJson({
        ...report,
        has_drift: hasDrift,
        ...(statusPayload.lock ? { lock: statusPayload.lock } : {}),
      });
      if (hasDrift) {
        process.exitCode = 1;
      }
      return;
    }
    if (!report.snapshot_id && !lockDrift) {
      ui.dim("No snapshots found. Drift detection requires a prior apply or mirror.");
      return;
    }
    if (!hasDrift) {
      ui.success("No drift detected since last snapshot.");
      return;
    }
    if (report.has_drift) {
      ui.danger(
        `Drift detected: ${report.changes.length} change(s) since snapshot ${report.snapshot_id}`,
      );
    }
    if (lockDrift && statusPayload.lock) {
      ui.danger(
        `Lock drift detected for root ${statusPayload.lock.root} (${statusPayload.lock.changes.length} version change(s)).`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const payload = await buildProjectStatusPayload(projectRoot);
  if (format === "json") {
    printJson(projectStatusPayloadToJson(payload));
    return;
  }
  renderProjectStatusHuman(payload);
}

function printMirrorSurfaceWarnings(
  warnings: Awaited<ReturnType<typeof syncProject>>["surface_warnings"],
): void {
  for (const warning of warnings) {
    ui.warn(
      `${warning.harness} surface ${warning.path} is not mirrored to ${warning.alias_harnesses.join(", ")}: ${warning.message}`,
    );
  }
}

async function handleProjectSyncCommand(
  path: string,
  opts: {
    dryRun?: boolean;
    format?: string;
    forceShiftReference?: string;
    reference?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);
  let referenceStrategy: ProjectReferenceStrategy;
  try {
    referenceStrategy = parseReferenceStrategy(opts.reference);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  try {
    const result = await (async () => {
      if (format === "human" && !opts.dryRun) {
        const spin = createProgress("Syncing…");
        const r = await syncProject({
          projectRoot,
          dryRun: false,
          forceShiftReference: opts.forceShiftReference,
          referenceStrategy,
        });
        spin.succeed(
          `Synced ${r.platforms_synced.join(", ") || "(none)"} from ${r.main_harness} ${ui.icons.bullet} ${formatCount(r.files_written, "file")}`,
        );
        printMirrorSurfaceWarnings(r.surface_warnings);
        return r;
      }
      return syncProject({
        projectRoot,
        dryRun: opts.dryRun,
        forceShiftReference: opts.forceShiftReference,
        referenceStrategy,
      });
    })();
    if (format === "json") {
      printJson(result);
      return;
    }
    printMirrorSurfaceWarnings(result.surface_warnings);
    if (opts.dryRun) {
      const dryTag = ui.theme.muted("[dry run] ");
      const verdict = ui.theme.success(
        `${ui.icons.success} Synced ${result.platforms_synced.join(", ") || "(none)"} from ${result.main_harness} ${ui.icons.bullet} ${formatCount(result.files_written, "file")}`,
      );
      console.log(dryTag + verdict);
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

/** Registers scan and use — call before inline `config` group registration. */
export function registerProjectCommandsBeforeConfig(root: Command): void {
  root
    .command("scan")
    .argument("[path]", "Project directory or plugin source to scan", ".")
    .option("--harness <slugs>", "Harness slug(s): scan filter, or install targets with --global")
    .option("--dry-run", "Show what would be imported without writing to DB")
    .option("--global", "Install imported plugin sources into global harness locations")
    .option("--overwrite", "Overwrite library resources when scan content differs")
    .option("--skip-existing", "Keep existing library resources when scan content differs")
    .option("--namespace <name>", "Namespace for imported project resources")
    .description(
      "Scan a project directory or plugin source and import configurations into the database",
    )
    .action(handleScanCommand);

  root
    .command("use")
    .description("Switch to a project-configured profile and environment")
    .option("--profile <name>", "Profile key from .harnesstap/config.toml")
    .option("--project <path>", "Project directory", ".")
    .option("--list", "List profiles from project config without applying")
    .option("--dry-run", "Show what would be written without applying")
    .option("--force", "Apply even when the profile is already active and in sync")
    .option("--no-pull", "Do not auto-pull missing published plugin dependencies")
    .option(
      "--harness <slugs>",
      "Comma-separated harness slugs (defaults to global harness preference)",
    )
    .option("--account <name>", "Cloud account name for dependency pulls")
    .option("--base-url <url>", "Cloud base URL for dependency pulls")
    .option(
      "--on-conflict <policy>",
      "When generated files already exist: replace, skip, or prompt",
    )
    .option("--no-interactive", "Disable interactive prompts")
    .option("--interactive", "Enable interactive prompts")
    .option("--format <mode>", "Output format: human or json", "human")
    .action(handleUseCommand);
}

/** Registers mirror, history, revert, and status — call after `config` group. */
export function registerProjectCommandsAfterConfig(root: Command): void {
  root
    .command("mirror")
    .argument("[path]", "Project directory", ".")
    .option("--dry-run", "Show what would be written without writing files")
    .option(
      "--force-shift-reference <slug>",
      "Set the project main harness before mirroring",
    )
    .option(
      "--reference <strategy>",
      "Reference source for mirror: main, plugin, agents, or auto",
      "main",
    )
    .option("--format <mode>", "Output format: human or json", "human")
    .description(
      "Mirror alias harness outputs from the main harness on-disk configuration",
    )
    .action(handleProjectSyncCommand);

  root
    .command("history")
    .argument("[path]", "Project directory", ".")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--show-id", "Show snapshot IDs in human-readable tables")
    .description("List configuration snapshots for a project")
    .action(handleHistoryCommand);

  root
    .command("revert")
    .argument("[snapshot-id]", "Snapshot ID to revert to")
    .description("Revert a project to a previous configuration snapshot")
    .action(handleRevertCommand);

  root
    .command("status")
    .argument("[path]", "Project directory", ".")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--check", "Exit with code 1 when snapshot or lock drift exists")
    .description("Show current project status and drift summary")
    .action(async (path: string, opts: { format?: string; check?: boolean }) => {
      await handleProjectStatusCommand(path, opts);
    });
}
