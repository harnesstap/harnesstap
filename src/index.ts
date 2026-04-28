import { Command } from "commander";
import chalk from "chalk";
import { getDb, closeDb, getDbPath } from "./db/connection.js";
import { initializeSchema } from "./db/schema.js";
import { log } from "./utils/logger.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "./services/git.js";
import {
  scanAndPersist,
  scanProject,
  detectPlatforms,
  scanAndPersistHomeDefaults,
} from "./services/scanner.js";
import {
  generateFiles,
  writeFiles,
} from "./services/applier.js";
import { exportToFile, importFromFile } from "./services/exporter.js";
import {
  listResources,
  deleteResource,
  resolveResource,
} from "./models/resource.js";
import {
  createPreset,
  getPreset,
  listPresets,
  deletePreset,
  addResourceToPreset,
  removeResourceFromPreset,
  getPresetResources,
} from "./models/preset.js";
import {
  upsertProject,
  getProject,
  getProjectByOrigin,
  applyPresetToProject,
  getProjectPresets,
} from "./models/project.js";
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
} from "./models/snapshot.js";
import { getAllPlatforms } from "./platforms/registry.js";
import { seedBuiltInPresets } from "./services/seed-presets.js";
import { resolve } from "node:path";
import type { Resource, ResourceType, SnapshotState } from "./types.js";
import { RESOURCE_TYPES } from "./types.js";

const program = new Command();

function printInitMeta(label: string, value: string): void {
  console.log(
    `  ${chalk.hex("#6b7280")(label.padEnd(10))} ${chalk.white(value)}`,
  );
}

function printInitDetail(label: string, value: string): void {
  console.log(
    `    ${chalk.hex("#7c3aed")(label.padEnd(8))} ${chalk.white(value)}`,
  );
}

function platformBadge(name: string): string {
  return chalk.bgHex("#1d4ed8").white.bold(` ${name} `);
}

function folderAccent(folder: string): string {
  return chalk.hex("#22c55e").bold(folder);
}

function statusAccent(message: string, importedCount: number): string {
  return importedCount > 0
    ? chalk.hex("#f59e0b").bold(message)
    : chalk.hex("#10b981").bold(message);
}

function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function summarizeResourceTypes(resources: Pick<Resource, "type">[]): string {
  const counts = new Map<ResourceType, number>();

  for (const resource of resources) {
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
  }

  const summary = RESOURCE_TYPES.filter(
    (type) => (counts.get(type) ?? 0) > 0,
  ).map((type) => formatCount(counts.get(type) ?? 0, type));

  return summary.join(", ");
}

function homeFolderLabel(discoveredPaths: string[]): string {
  const firstPath = discoveredPaths[0];
  if (!firstPath) return "~";

  const segments = firstPath.replace(/\/$/, "").split("/");
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : firstPath;
}

function relativeDiscoveredPaths(
  discoveredPaths: string[],
  folder: string,
): string {
  return discoveredPaths
    .map((path) => {
      if (!path.startsWith(`${folder}/`)) return path;
      return path.slice(folder.length + 1);
    })
    .sort()
    .join(", ");
}

function warnDeprecatedCommand(
  legacyCommand: string,
  replacementCommand: string,
): void {
  log.warn(
    `\`${legacyCommand}\` is deprecated; use \`${replacementCommand}\` instead.`,
  );
}

program
  .name("harnessdeck")
  .description(
    "Preset-based AI coding assistant configuration manager for Claude Code, Codex, Cursor, and other coding CLIs",
  )
  .version("0.1.0")
  .helpCommand(false);

async function handleScanCommand(
  path: string,
  opts: { platform?: string; dryRun?: boolean },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);

  const detected = detectPlatforms(projectRoot);
  if (detected.length === 0) {
    log.warn("No coding CLI configurations detected in this directory.");
    return;
  }
  log.info(`Detected platforms: ${detected.join(", ")}`);

  if (opts.dryRun) {
    log.dim("(dry run — not persisting to database)");
    const results = await scanProject(projectRoot, opts.platform);
    let count = 0;
    for (const result of results) {
      log.info(`Platform: ${result.platformId}`);
      for (const resource of result.resources) {
        count++;
        log.dim(`  ${resource.type.padEnd(14)} ${resource.name}`);
      }
    }
    log.success(`Would import ${count} resources`);
    return;
  }

  const resources = await scanAndPersist(projectRoot, opts.platform);
  log.success(`Imported ${resources.length} resources`);

  for (const resource of resources) {
    log.dim(`  ${resource.type.padEnd(14)} ${resource.name}`);
  }

  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    return;
  }

  const normalized = normalizeGitUrl(gitOrigin);
  const name = projectNameFromUrl(gitOrigin);
  upsertProject({
    git_origin: normalized,
    name,
    local_path: projectRoot,
  });
  log.info(`Project registered: ${name} (${normalized})`);
}

async function handleApplyCommand(
  presetName: string,
  opts: { project: string; platform?: string; dryRun?: boolean },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  const preset = getPreset(presetName);
  if (!preset) {
    log.error(`Preset not found: ${presetName}`);
    return;
  }

  const projectRoot = resolve(opts.project);
  const platforms = opts.platform
    ? opts.platform.split(",")
    : detectPlatforms(projectRoot);

  if (platforms.length === 0) {
    log.warn("No platforms detected. Use --platform to specify.");
    return;
  }

  const resources = getPresetResources(preset.id);
  const generated = await generateFiles(resources, platforms, projectRoot);

  const gitOrigin = getGitOrigin(projectRoot);
  if (gitOrigin) {
    const normalized = normalizeGitUrl(gitOrigin);
    const project = upsertProject({
      git_origin: normalized,
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });

    const snapshotState: SnapshotState = {
      presets: [preset],
      resources,
      platform_files: Object.fromEntries(
        generated.map((result) => [
          result.platformId,
          Object.fromEntries(result.files.map((file) => [file.path, file.content])),
        ]),
      ),
    };
    createSnapshot({
      project_id: project.id,
      label: `Before applying: ${preset.name}`,
      state: snapshotState,
    });

    applyPresetToProject({
      project_id: project.id,
      preset_id: preset.id,
      platforms,
    });
  }

  if (opts.dryRun) {
    log.dim("(dry run — showing files that would be written)");
    for (const result of generated) {
      log.info(`Platform: ${result.platformId}`);
      for (const file of result.files) {
        log.dim(`  ${file.path}`);
      }
    }
    return;
  }

  for (const result of generated) {
    writeFiles(result.files, projectRoot);
    log.success(`${result.platformId}: wrote ${result.files.length} file(s)`);
    for (const file of result.files) {
      log.dim(`  ${file.path}`);
    }
  }
}

function handleHistoryCommand(opts: { project: string }): void {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(opts.project);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    log.error("Not a git repository.");
    return;
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    log.warn("No project record found. Run `harnessdeck project scan` first.");
    return;
  }
  const snapshots = listSnapshots(project.id);
  if (snapshots.length === 0) {
    log.dim("No snapshots found.");
    return;
  }
  for (const snapshot of snapshots) {
    log.info(`${snapshot.id.slice(0, 10)}… ${snapshot.created_at} — ${snapshot.label}`);
  }
}

function handleRevertCommand(snapshotId?: string): void {
  const db = getDb();
  initializeSchema(db);
  if (!snapshotId) {
    log.error(
      "Please provide a snapshot ID. Use `harnessdeck project history` to list them.",
    );
    return;
  }
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    log.error(`Snapshot not found: ${snapshotId}`);
    return;
  }
  const project = getProject(snapshot.project_id);
  if (!project) {
    log.error("Snapshot project not found.");
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
  log.info(`Reverting to snapshot: ${snapshot.label} (${snapshot.created_at})`);
  log.success(`Restored ${files.length} file(s) to ${project.local_path}`);
}

function handlePresetExportCommand(
  presetName: string,
  opts: { file?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const filePath = opts.file ?? `${presetName}.harnessdeck.json`;
  exportToFile(presetName, filePath);
  log.success(`Exported to ${filePath}`);
}

function handlePresetImportCommand(file: string): void {
  const db = getDb();
  initializeSchema(db);
  const { preset, resources } = importFromFile(file);
  log.success(
    `Imported preset "${preset.name}" with ${resources.length} resources`,
  );
}

function handlePlatformListCommand(): void {
  const platforms = getAllPlatforms();
  for (const platform of platforms) {
    const features = [...platform.supports].join(", ");
    log.info(`${platform.id.padEnd(20)} ${platform.name.padEnd(20)} [${features}]`);
  }
}

function handleProjectStatusCommand(path: string): void {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);
  const gitOrigin = getGitOrigin(projectRoot);
  const detected = detectPlatforms(projectRoot);

  console.log(`Project root:  ${projectRoot}`);
  console.log(`Git origin:    ${gitOrigin ?? "(none)"}`);
  console.log(`Platforms:     ${detected.join(", ") || "(none detected)"}`);

  if (!gitOrigin) {
    return;
  }

  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    return;
  }

  const presets = getProjectPresets(project.id);
  const snapshots = listSnapshots(project.id);
  console.log(`Applied presets: ${presets.length}`);
  console.log(`Snapshots:       ${snapshots.length}`);
}

// ── init ────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize the harnessdeck database and config directory")
  .action(async () => {
    const db = getDb();
    initializeSchema(db);
    const seeded = seedBuiltInPresets();
    const homeDefaults = await scanAndPersistHomeDefaults();
    const platformNames = new Map(
      getAllPlatforms().map((platform) => [platform.id, platform.name]),
    );

    log.success(chalk.bold("Harnessdeck initialized"));
    printInitMeta("Database", getDbPath());
    printInitMeta(
      "Built-in Presets",
      seeded > 0
        ? `seeded ${formatCount(seeded, "built-in preset")}`
        : "already up to date",
    );

    if (homeDefaults.detected.length === 0) {
      printInitMeta(
        "Home",
        chalk.hex("#9ca3af")("no default folders discovered"),
      );
      return;
    }

    log.info(chalk.bold("Home defaults overview"));
    for (const result of homeDefaults.results) {
      const folder = homeFolderLabel(result.discoveredPaths);
      const foundSummary = summarizeResourceTypes(result.resources);
      const importedCount = result.importedCount;
      const importedSummary =
        importedCount > 0
          ? `${formatCount(importedCount, "new resource")} imported`
          : "already tracked";

      console.log(
        `  ${platformBadge(platformNames.get(result.platformId) ?? result.platformId)} ${folderAccent(folder)}`,
      );
      printInitDetail(
        "Contains",
        chalk.hex("#60a5fa")(
          relativeDiscoveredPaths(result.discoveredPaths, folder),
        ),
      );
      printInitDetail(
        "Found",
        `${chalk.bold(formatCount(result.resources.length, "resource"))}${foundSummary ? ` ${chalk.hex("#f472b6")(`(${foundSummary})`)}` : ""}`,
      );
      printInitDetail("Status", statusAccent(importedSummary, importedCount));
    }
  });

// ── preset ──────────────────────────────────────────────────────────────

const presetCmd = program
  .command("preset")
  .description("Manage presets (named bundles of resources that can be applied to a project)");
presetCmd.helpCommand(false);
presetCmd.helpCommand(false);

presetCmd
  .command("create")
  .argument("<name>", "Preset name")
  .option("-d, --description <text>", "Preset description")
  .option("--tags <tags>", "Comma-separated tags")
  .action(
    (
      name: string,
      opts: { description?: string; tags?: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];
      const preset = createPreset({
        name,
        description: opts.description,
        tags,
      });
      log.success(`Preset created: ${preset.name} (${preset.id})`);
    },
  );

presetCmd
  .command("list")
  .alias("ls")
  .action(() => {
    const db = getDb();
    initializeSchema(db);
    const presets = listPresets();
    if (presets.length === 0) {
      log.dim("No presets found.");
      return;
    }
    for (const p of presets) {
      log.info(`${p.name} — ${p.description || "(no description)"}`);
    }
  });

presetCmd
  .command("show")
  .argument("<name>", "Preset name or ID")
  .action((name: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(name);
    if (!preset) {
      log.error(`Preset not found: ${name}`);
      return;
    }
    log.info(`${preset.name} — ${preset.description}`);
    const resources = getPresetResources(preset.id);
    for (const r of resources) {
      log.dim(`  ${r.type.padEnd(14)} ${r.name} (${r.id})`);
    }
  });

presetCmd
  .command("add")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource-id>", "Resource ID to add")
  .action((presetName: string, resourceId: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    addResourceToPreset(preset.id, resourceId);
    log.success(`Added resource ${resourceId} to preset ${preset.name}`);
  });

presetCmd
  .command("remove")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource-id>", "Resource ID to remove")
  .action((presetName: string, resourceId: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    removeResourceFromPreset(preset.id, resourceId);
    log.success(`Removed resource ${resourceId} from preset ${preset.name}`);
  });

presetCmd
  .command("delete")
  .argument("<name>", "Preset name or ID")
  .action((name: string) => {
    const db = getDb();
    initializeSchema(db);
    if (deletePreset(name)) {
      log.success(`Preset deleted: ${name}`);
    } else {
      log.error(`Preset not found: ${name}`);
    }
  });

presetCmd
  .command("export")
  .argument("<preset>", "Preset name or ID")
  .option("-f, --file <path>", "Output file path")
  .description("Export a preset as a shareable JSON bundle")
  .action(handlePresetExportCommand);

presetCmd
  .command("import")
  .argument("<file>", "JSON bundle file to import")
  .description("Import a preset from a JSON bundle file")
  .action(handlePresetImportCommand);

// ── resource ────────────────────────────────────────────────────────────

const resourceCmd = program
  .command("resource")
  .description("Manage resources (individual pieces of AI configuration like agents, skills, or instructions)");
resourceCmd.helpCommand(false);
resourceCmd.helpCommand(false);

resourceCmd
  .command("list")
  .alias("ls")
  .option("-t, --type <type>", "Filter by resource type")
  .option("-s, --search <query>", "Search by name or description")
  .action((opts: { type?: string; search?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const type = opts.type as ResourceType | undefined;
    if (type && !RESOURCE_TYPES.includes(type)) {
      log.error(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    const resources = listResources({ type, search: opts.search });
    if (resources.length === 0) {
      log.dim("No resources found.");
      return;
    }
    for (const r of resources) {
      log.info(`${r.id} ${r.type.padEnd(14)} ${r.name}`);
    }
  });

resourceCmd
  .command("show")
  .argument("<resource>", "Resource name or ID")
  .action((resource: string) => {
    const db = getDb();
    initializeSchema(db);
    const result = resolveResource(resource);
    if (result.status === "not_found") {
      log.error(`Resource not found: ${resource}`);
      return;
    }
    if (result.status === "ambiguous") {
      log.error(`Ambiguous resource name: ${resource}`);
      for (const match of result.matches) {
        log.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
      }
      return;
    }
    const r = result.resource;
    console.log(`Type:        ${r.type}`);
    console.log(`Name:        ${r.name}`);
    console.log(`Description: ${r.description}`);
    console.log(`Source:      ${r.source}`);
    console.log(`Created:     ${r.created_at}`);
    console.log(`Metadata:    ${JSON.stringify(r.metadata, null, 2)}`);
    console.log(`\n--- Content ---\n${r.content}`);
  });

resourceCmd
  .command("delete")
  .argument("<resource>", "Resource name or ID")
  .action((resource: string) => {
    const db = getDb();
    initializeSchema(db);
    const result = resolveResource(resource);
    if (result.status === "not_found") {
      log.error(`Resource not found: ${resource}`);
      return;
    }
    if (result.status === "ambiguous") {
      log.error(`Ambiguous resource name: ${resource}`);
      for (const match of result.matches) {
        log.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
      }
      return;
    }
    if (deleteResource(result.resource.id)) {
      log.success(`Deleted resource: ${result.resource.name} (${result.resource.id})`);
    } else {
      log.error(`Resource not found: ${resource}`);
    }
  });

// ── project ─────────────────────────────────────────────────────────────

const projectCmd = program
  .command("project")
  .description("Manage project scanning, apply state, and snapshots");
projectCmd.helpCommand(false);
projectCmd.helpCommand(false);

projectCmd
  .command("scan")
  .argument("[path]", "Project directory to scan", ".")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--dry-run", "Show what would be imported without writing to DB")
  .description(
    "Scan a project directory and import configurations into the database",
  )
  .action(handleScanCommand);

projectCmd
  .command("apply")
  .argument("<preset>", "Preset name or ID")
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .option("--dry-run", "Show what would be written")
  .description("Apply a preset to a project, serializing for each platform")
  .action(handleApplyCommand);

projectCmd
  .command("history")
  .option("--project <path>", "Project directory", ".")
  .description("List configuration snapshots for a project")
  .action(handleHistoryCommand);

projectCmd
  .command("revert")
  .argument("[snapshot-id]", "Snapshot ID to revert to")
  .description("Revert a project to a previous configuration snapshot")
  .action(handleRevertCommand);

projectCmd
  .command("status")
  .argument("[path]", "Project directory", ".")
  .description("Show current project status")
  .action(handleProjectStatusCommand);

// ── platform ────────────────────────────────────────────────────────────

const platformCmd = program
  .command("platform")
  .description("Inspect supported platforms (target coding assistants or formats like Claude Code, Cursor, or Codex)");
platformCmd.helpCommand(false);
platformCmd.helpCommand(false);

platformCmd
  .command("list")
  .alias("ls")
  .description(
    "List all supported platforms (e.g., Claude Code, Cursor, Codex)",
  )
  .action(handlePlatformListCommand);

// ── hidden compatibility aliases ────────────────────────────────────────

program
  .command("scan", { hidden: true })
  .argument("[path]", "Project directory to scan", ".")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--dry-run", "Show what would be imported without writing to DB")
  .action(async (path: string, opts: { platform?: string; dryRun?: boolean }) => {
    warnDeprecatedCommand("harnessdeck scan", "harnessdeck project scan");
    await handleScanCommand(path, opts);
  });

program
  .command("apply", { hidden: true })
  .argument("<preset>", "Preset name or ID")
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .option("--dry-run", "Show what would be written")
  .action(
    async (
      presetName: string,
      opts: { project: string; platform?: string; dryRun?: boolean },
    ) => {
      warnDeprecatedCommand("harnessdeck apply", "harnessdeck project apply");
      await handleApplyCommand(presetName, opts);
    },
  );

program
  .command("history", { hidden: true })
  .option("--project <path>", "Project directory", ".")
  .action((opts: { project: string }) => {
    warnDeprecatedCommand("harnessdeck history", "harnessdeck project history");
    handleHistoryCommand(opts);
  });

program
  .command("revert", { hidden: true })
  .argument("[snapshot-id]", "Snapshot ID to revert to")
  .action((snapshotId?: string) => {
    warnDeprecatedCommand("harnessdeck revert", "harnessdeck project revert");
    handleRevertCommand(snapshotId);
  });

program
  .command("status", { hidden: true })
  .argument("[path]", "Project directory", ".")
  .action((path: string) => {
    warnDeprecatedCommand("harnessdeck status", "harnessdeck project status");
    handleProjectStatusCommand(path);
  });

program
  .command("export", { hidden: true })
  .argument("<preset>", "Preset name or ID")
  .option("-f, --file <path>", "Output file path")
  .action((presetName: string, opts: { file?: string }) => {
    warnDeprecatedCommand("harnessdeck export", "harnessdeck preset export");
    handlePresetExportCommand(presetName, opts);
  });

program
  .command("import", { hidden: true })
  .argument("<file>", "JSON bundle file to import")
  .action((file: string) => {
    warnDeprecatedCommand("harnessdeck import", "harnessdeck preset import");
    handlePresetImportCommand(file);
  });

program
  .command("platforms", { hidden: true })
  .action(() => {
    warnDeprecatedCommand("harnessdeck platforms", "harnessdeck platform list");
    handlePlatformListCommand();
  });


// ── cleanup ─────────────────────────────────────────────────────────────

process.on("exit", () => closeDb());

await program.parseAsync();
