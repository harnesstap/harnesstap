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
  persistClaudePluginInventoryForProject,
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
  syncClaudePresetPluginsAfterAdd,
  syncClaudePresetPluginsAfterRemove,
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
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Resource, ResourceType, SnapshotState } from "./types.js";
import { RESOURCE_TYPES } from "./types.js";
import {
  declaringScopesForClaudePlugin,
  scanClaudePluginInventory,
} from "./services/claude-plugin-inventory.js";
import {
  checkPlugins,
  listPlugins,
  refreshPluginSources,
  updatePlugins,
} from "./services/plugin-lifecycle.js";
import {
  addPluginToPreset,
  getProjectPluginState,
  listPresetPlugins,
  removePluginFromPreset,
  upsertProjectPluginState,
} from "./models/plugin.js";
import type { PluginScope } from "./plugins/types.js";
import {
  getHarnessPreference,
  setHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "./models/harness.js";
import { resolveHarnessSelection } from "./services/harness-config.js";
import { parseOutputFormat, printJson } from "./utils/output-format.js";
import { parseVersionConstraint } from "./services/plugin-constraints.js";
import { validatePresetPluginConstraints } from "./services/plugin-apply-validation.js";
import { detectProjectDriftFromLatest } from "./services/project-drift.js";
import { diffPresets } from "./services/preset-diff.js";
import { validatePreset } from "./services/preset-validate.js";
import { mergePresets } from "./services/preset-merge.js";
import { createPresetFromProject } from "./services/preset-from-project.js";
import { isPresetUrl, fetchPresetBundleToTempFile, isBundleFilePath } from "./services/preset-source.js";
import { syncProject } from "./services/project-sync.js";
import {
  exportMigrationState,
  importMigrationState,
} from "./services/migrate.js";

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
  .version("0.1.0", "-V, --harnessdeck-version")
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
  const scannedPlatformIds = opts.platform ? [opts.platform] : detected;

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

  try {
    const pluginSummary = await listPlugins({
      projectRoot,
      homeRoot: homedir(),
      platformIds: parsePlatformFilter(opts.platform),
    });
    if (pluginSummary.installs.length > 0) {
      const check = await checkPlugins({
        projectRoot,
        homeRoot: homedir(),
        platformIds: parsePlatformFilter(opts.platform),
      });
      log.info(
        `Plugins: ${formatCount(pluginSummary.installs.length, "installed")} (${formatCount(check.summary.outdated, "outdated")})`,
      );
    }
  } catch {
    // Plugin scan is best-effort during project scan
  }

  for (const resource of resources) {
    log.dim(`  ${resource.type.padEnd(14)} ${resource.name}`);
  }

  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    return;
  }

  const normalized = normalizeGitUrl(gitOrigin);
  const name = projectNameFromUrl(gitOrigin);
  const registered = upsertProject({
    git_origin: normalized,
    name,
    local_path: projectRoot,
  });
  log.info(`Project registered: ${name} (${normalized})`);

  try {
    const inventorySummary = await persistClaudePluginInventoryForProject({
      projectRoot,
      projectId: registered.id,
      scannedPlatformIds,
      homeRoot: homedir(),
    });
    if (inventorySummary) {
      log.info(
        `Plugins (claude-code): ${inventorySummary.committed_count} committed, ${inventorySummary.effective_count} effective`,
      );
    }
  } catch {
    // plugin inventory persistence is best-effort during project scan
  }
}

async function resolveApplyPresets(
  presetNames: [string, ...string[]],
  projectRoot: string,
): Promise<{
  presets: ReturnType<typeof getPreset>[];
  resources: Resource[];
  claude?: import("./types.js").ClaudePresetConfig;
  primaryPresetId: string;
}> {
  if (presetNames.length === 1 && isPresetUrl(presetNames[0])) {
    const tempFile = await fetchPresetBundleToTempFile(presetNames[0]);
    const { preset, resources } = importFromFile(tempFile, {
      embeddedTargetDir: projectRoot,
    });
    return {
      presets: [preset],
      resources,
      claude: preset.claude,
      primaryPresetId: preset.id,
    };
  }

  if (presetNames.length === 1 && isBundleFilePath(presetNames[0])) {
    const { preset, resources } = importFromFile(presetNames[0], {
      embeddedTargetDir: projectRoot,
    });
    return {
      presets: [preset],
      resources,
      claude: preset.claude,
      primaryPresetId: preset.id,
    };
  }

  if (presetNames.length > 1) {
    const merged = mergePresets(presetNames);
    return {
      presets: merged.presets,
      resources: merged.resources,
      claude: merged.claude,
      primaryPresetId: merged.presets[merged.presets.length - 1]?.id ?? "",
    };
  }

  const preset = getPreset(presetNames[0]);
  if (!preset) {
    throw new Error(`Preset not found: ${presetNames[0]}`);
  }
  return {
    presets: [preset],
    resources: getPresetResources(preset.id),
    claude: preset.claude,
    primaryPresetId: preset.id,
  };
}

async function handleApplyCommand(
  presetNames: [string, ...string[]] | [],
  opts: {
    project: string;
    platform?: string;
    dryRun?: boolean;
    format?: string;
    ignorePluginVersions?: boolean;
    strictPluginVersions?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  if (presetNames.length === 0) {
    log.error("Provide at least one preset name, bundle path, or URL.");
    return;
  }

  const projectRoot = resolve(opts.project);
  let applyBundle: Awaited<ReturnType<typeof resolveApplyPresets>>;
  try {
    applyBundle = await resolveApplyPresets(
      presetNames as [string, ...string[]],
      projectRoot,
    );
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    return;
  }

  const primaryPreset = applyBundle.presets[applyBundle.presets.length - 1];
  if (!primaryPreset) {
    log.error("No preset resolved for apply");
    return;
  }

  const platforms = opts.platform
    ? opts.platform.split(",")
    : detectPlatforms(projectRoot);

  if (platforms.length === 0) {
    log.warn("No platforms detected. Use --platform to specify.");
    return;
  }

  const { resources, claude } = applyBundle;
  const generated = await generateFiles(
    resources,
    platforms,
    projectRoot,
    claude,
  );

  const gitOrigin = getGitOrigin(projectRoot);
  if (gitOrigin) {
    const normalized = normalizeGitUrl(gitOrigin);
    const project = upsertProject({
      git_origin: normalized,
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });

    const snapshotState: SnapshotState = {
      presets: applyBundle.presets.filter((p): p is NonNullable<typeof p> => p != null),
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
      label:
        presetNames.length > 1
          ? `Before applying: ${presetNames.join(" + ")}`
          : `Before applying: ${primaryPreset.name}`,
      state: snapshotState,
    });

    applyPresetToProject({
      project_id: project.id,
      preset_id: applyBundle.primaryPresetId,
      platforms,
    });
  }

  if (opts.dryRun) {
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        preset: primaryPreset.name,
        presets: presetNames,
        project_root: projectRoot,
        platforms: generated.map((result) => ({
          platform: result.platformId,
          files: result.files.map((file) => ({ path: file.path })),
        })),
      });
      return;
    }
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

  if (
    !opts.ignorePluginVersions &&
    listPresetPlugins(applyBundle.primaryPresetId).length > 0
  ) {
    const inventory = await refreshClaudePluginInventoryForCli(projectRoot);
    const issues = validatePresetPluginConstraints(
      applyBundle.primaryPresetId,
      inventory,
    );
    for (const issue of issues) {
      console.warn(chalk.yellow(issue.message));
    }
    if (opts.strictPluginVersions && issues.length > 0) {
      process.exitCode = 2;
    }
  }
}

function handleHistoryCommand(opts: { project: string; format?: string }): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    log.error("Not a git repository.");
    return;
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    if (format === "json") {
      printJson({ snapshots: [] });
      return;
    }
    log.warn("No project record found. Run `harnessdeck project scan` first.");
    return;
  }
  const snapshots = listSnapshots(project.id);
  if (snapshots.length === 0) {
    if (format === "json") {
      printJson({ snapshots: [] });
      return;
    }
    log.dim("No snapshots found.");
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
  for (const snapshot of snapshots) {
    log.info(`${snapshot.id} ${snapshot.created_at} — ${snapshot.label}`);
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
  opts: { file?: string; embedPlugins?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const filePath = opts.file ?? `${presetName}.harnessdeck.json`;
  exportToFile(presetName, filePath, { embedPlugins: opts.embedPlugins });
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

function handlePlatformListCommand(opts: { format?: string } = {}): void {
  const format = parseOutputFormat(opts.format);
  const platforms = getAllPlatforms();
  if (format === "json") {
    printJson(platforms);
    return;
  }
  for (const platform of platforms) {
    const features = [...platform.supports].join(", ");
    log.info(`${platform.id.padEnd(20)} ${platform.name.padEnd(20)} [${features}]`);
  }
}

function handlePresetShowCommand(
  name: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const preset = getPreset(name);
  if (!preset) {
    log.error(`Preset not found: ${name}`);
    return;
  }
  const resources = getPresetResources(preset.id);
  const plugins = listPresetPlugins(preset.id);

  if (format === "json") {
    printJson({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      tags: preset.tags,
      ...(preset.claude ? { claude: preset.claude } : {}),
      created_at: preset.created_at,
      updated_at: preset.updated_at,
      resources,
      plugins,
    });
    return;
  }

  log.info(`${preset.name} — ${preset.description}`);
  for (const r of resources) {
    log.dim(`  ${r.type.padEnd(14)} ${r.name} (${r.id})`);
  }
  if (plugins.length > 0) {
    console.log(chalk.bold("Plugins"));
    for (const p of plugins) {
      log.dim(`  ${p.ref.padEnd(42)} ${p.version_constraint}`);
    }
  }
}

function parsePlatformFilter(platform?: string): string[] | undefined {
  return platform?.split(",").map((p) => p.trim()).filter(Boolean);
}

function parseScopeFilter(scope?: string): PluginScope[] | undefined {
  if (!scope) return undefined;
  return scope.split(",").map((s) => s.trim()) as PluginScope[];
}

function parseHarnessAliases(aliases?: string): string[] | undefined {
  return aliases
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function pluginLifecycleBase(path: string, opts: { platform?: string }) {
  return {
    projectRoot: resolve(path),
    homeRoot: homedir(),
    platformIds: parsePlatformFilter(opts.platform),
  };
}

async function refreshClaudePluginInventoryForCli(
  path: string,
): Promise<ReturnType<typeof scanClaudePluginInventory>> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);
  const homeRoot = homedir();
  const inventory = await scanClaudePluginInventory({ projectRoot, homeRoot });

  const gitOrigin = getGitOrigin(projectRoot);
  if (gitOrigin) {
    const normalized = normalizeGitUrl(gitOrigin);
    const project = upsertProject({
      git_origin: normalized,
      name: projectNameFromUrl(gitOrigin),
      local_path: projectRoot,
    });
    upsertProjectPluginState(project.id, inventory);
  }

  return inventory;
}

function sortByRef(installs: { ref: string }[]): void {
  installs.sort((a, b) => a.ref.localeCompare(b.ref));
}

async function handlePluginInventoryListCommand(
  path: string,
  opts: { format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const inventory = await refreshClaudePluginInventoryForCli(path);

  if (format === "json") {
    printJson({
      scanned_at: inventory.scanned_at,
      committed: inventory.committed,
      effective: inventory.effective,
    });
    return;
  }

  const committed = [...inventory.committed];
  const effective = [...inventory.effective];
  sortByRef(committed);
  sortByRef(effective);

  const formatEnabled = (v: boolean) =>
    v ? chalk.green("yes") : chalk.hex("#6b7280")("no");

  console.log(chalk.bold("Committed"));
  if (committed.length === 0) {
    console.log(chalk.hex("#6b7280")("  (none)"));
  } else {
    console.log(`  ${"ref".padEnd(42)} ${"version".padEnd(14)} enabled`);
    for (const row of committed) {
      console.log(
        `  ${row.ref.padEnd(42)} ${row.version.padEnd(14)} ${formatEnabled(row.enabled)}`,
      );
    }
  }

  console.log();
  console.log(chalk.bold("Effective"));
  if (effective.length === 0) {
    console.log(chalk.hex("#6b7280")("  (none)"));
  } else {
    console.log(`  ${"ref".padEnd(42)} ${"version".padEnd(14)} enabled    scope`);
    for (const row of effective) {
      console.log(
        `  ${row.ref.padEnd(42)} ${row.version.padEnd(14)} ${formatEnabled(row.enabled)}    ${row.scope}`,
      );
    }
  }
}

async function handlePluginInventoryShowCommand(
  ref: string,
  path: string,
  opts: { format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);
  const homeRoot = homedir();
  const inventory = await refreshClaudePluginInventoryForCli(path);
  const install = inventory.effective.find((row) => row.ref === ref) ?? null;
  const declaredScopes = declaringScopesForClaudePlugin(ref, {
    projectRoot,
    homeRoot,
  });

  const entries =
    install == null
      ? []
      : [{ ...install, declared_by_scopes: declaredScopes }];

  if (format === "json") {
    printJson({ ref, entries });
    return;
  }

  console.log(`${chalk.bold("ref:")} ${ref}`);
  if (declaredScopes.length > 0) {
    console.log(
      `${chalk.bold("Declared by scopes:")} ${declaredScopes.join(", ")}`,
    );
  } else {
    console.log(
      `${chalk.bold("Declared by scopes:")} ${chalk.hex("#6b7280")("(none)")}`,
    );
  }

  if (install == null) {
    console.log(
      chalk.hex("#f59e0b")("No matching entry in merged effective inventory."),
    );
    return;
  }

  console.log(chalk.bold("Effective install:"));
  console.log(`  platform: ${install.platformId}`);
  console.log(`  version:  ${install.version}`);
  console.log(`  enabled:  ${install.enabled ? chalk.green("yes") : chalk.hex("#6b7280")("no")}`);
  console.log(`  scope:    ${install.scope}`);
  if (install.installPath) {
    console.log(`  path:     ${install.installPath}`);
  }
}

async function handlePluginInstalledListCommand(
  path: string,
  opts: { platform?: string; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const result = await listPlugins(pluginLifecycleBase(path, opts));
  if (format === "json") {
    printJson(result);
    return;
  }
  if (result.installs.length === 0) {
    log.dim("No plugins found.");
  }
  for (const install of result.installs) {
    log.info(
      `${install.platformId.padEnd(12)} ${install.ref.padEnd(36)} ${install.version.padEnd(12)} ${install.scope}`,
    );
  }
  if (result.unsupported_platforms.length > 0) {
    log.dim(`Unsupported platforms: ${result.unsupported_platforms.join(", ")}`);
  }
}

async function handlePluginCheckCommand(
  path: string,
  opts: { platform?: string; scope?: string; refresh?: boolean; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const report = await checkPlugins({
    ...pluginLifecycleBase(path, opts),
    scopes: parseScopeFilter(opts.scope),
    forceRefresh: opts.refresh ?? false,
  });
  if (format === "json") {
    printJson(report);
    if (report.summary.outdated > 0) process.exitCode = 1;
    return;
  }
  log.info(
    `Plugins: ${report.summary.outdated} outdated, ${report.summary.current} current, ${report.summary.unknown} unknown`,
  );
  for (const row of report.results) {
    const arrow =
      row.status === "outdated" && row.latestVersion
        ? ` → ${row.latestVersion}`
        : "";
    log.info(
      `${row.platformId.padEnd(12)} ${row.ref.padEnd(36)} ${row.version}${arrow}  ${row.scope.padEnd(8)} ${row.status}`,
    );
  }
  if (report.unsupported_platforms.length > 0) {
    log.dim(`Unsupported platforms: ${report.unsupported_platforms.join(", ")}`);
  }
  if (report.summary.outdated > 0) process.exitCode = 1;
}

async function handlePluginUpdateCommand(
  ref: string | undefined,
  opts: {
    platform?: string;
    scope?: string;
    all?: boolean;
    yes?: boolean;
    format?: string;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const report = await updatePlugins({
    ...pluginLifecycleBase(".", opts),
    ref,
    all: opts.all,
    yes: opts.yes,
    scopes: parseScopeFilter(opts.scope),
  });
  if (format === "json") {
    printJson(report);
    if (report.summary.failed > 0) process.exitCode = 1;
    return;
  }
  for (const row of report.results) {
    log.info(`${row.ref}: ${row.status} — ${row.message}`);
  }
  if (report.summary.failed > 0) process.exitCode = 1;
}

async function handlePluginRefreshCommand(
  opts: { platform?: string; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const result = await refreshPluginSources(pluginLifecycleBase(".", opts));
  if (format === "json") {
    printJson(result);
    return;
  }
  log.success(`Refreshed ${result.refreshed_sources.length} source(s)`);
  for (const source of result.refreshed_sources) {
    log.dim(`  ${source}`);
  }
}

async function handleProjectStatusCommand(
  path: string,
  opts: { format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);
  const gitOrigin = getGitOrigin(projectRoot);
  const detected = detectPlatforms(projectRoot);

  if (!gitOrigin) {
    if (format === "json") {
      printJson({
        project_root: projectRoot,
        git_origin: null,
        platforms: detected,
      });
      return;
    }
    console.log(`Project root:  ${projectRoot}`);
    console.log(`Git origin:    (none)`);
    console.log(`Platforms:     ${detected.join(", ") || "(none detected)"}`);
    return;
  }

  const normalizedOrigin = normalizeGitUrl(gitOrigin);
  const project = getProjectByOrigin(normalizedOrigin);
  const presets = project ? getProjectPresets(project.id) : [];
  const snapshots = project ? listSnapshots(project.id) : [];

  if (format === "json") {
    const inventory =
      project && detected.includes("claude-code")
        ? getProjectPluginState(project.id)
        : null;
    const payload: Record<string, unknown> = {
      project_root: projectRoot,
      git_origin: normalizedOrigin,
      platforms: detected,
    };
    if (project) {
      payload.applied_presets = presets.length;
      payload.snapshots = snapshots.length;
    }
    if (detected.includes("claude-code")) {
      payload.claude_code = {
        plugins: inventory
          ? {
              scanned_at: inventory.scanned_at,
              committed_count: inventory.committed.length,
              effective_count: inventory.effective.length,
            }
          : null,
      };
    }
    printJson(payload);
    return;
  }

  console.log(`Project root:  ${projectRoot}`);
  console.log(`Git origin:    ${gitOrigin}`);
  console.log(`Platforms:     ${detected.join(", ") || "(none detected)"}`);

  if (!project) {
    return;
  }

  console.log(`Applied presets: ${presets.length}`);
  console.log(`Snapshots:       ${snapshots.length}`);

  if (detected.includes("claude-code")) {
    const inventory = getProjectPluginState(project.id);
    if (inventory) {
      console.log(
        `Plugins (claude-code): ${inventory.committed.length} committed, ${inventory.effective.length} effective`,
      );
    }
  }

  try {
    const plugins = await listPlugins({ projectRoot, homeRoot: homedir() });
    if (plugins.installs.length > 0) {
      const check = await checkPlugins({ projectRoot, homeRoot: homedir() });
      console.log(
        `Plugins:         ${plugins.installs.length} installed (${check.summary.outdated} outdated)`,
      );
    }
  } catch {
    // best-effort
  }
}

async function handleInitCommand(opts: {
  format?: string;
  main?: string;
  aliases?: string;
  interactive?: boolean;
} = {}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const seeded = seedBuiltInPresets();
  const homeDefaults = await scanAndPersistHomeDefaults();
  const interactiveSelection =
    format === "human" && opts.interactive && process.stdin.isTTY;
  const autoPromptSelection =
    format === "human" &&
    !opts.main &&
    !opts.aliases &&
    process.stdin.isTTY;
  const shouldSelectHarness =
    interactiveSelection ||
    autoPromptSelection ||
    Boolean(opts.main) ||
    Boolean(opts.aliases);
  let savedHarnessPreference:
    | ReturnType<typeof setHarnessPreference>
    | undefined;

  if (shouldSelectHarness) {
    const selection = await resolveHarnessSelection({
      main: opts.main,
      aliases: parseHarnessAliases(opts.aliases),
      nonInteractive: !(interactiveSelection || autoPromptSelection),
      current: getHarnessPreference(),
      detected: homeDefaults.detected.map((result) => result.platformId),
      mainMessage: "Select the default main harness",
      aliasMessage: "Select default alias harnesses to keep in sync",
    });
    savedHarnessPreference = setHarnessPreference(selection);
  }

  if (format === "json") {
    printJson({
      built_in_presets: {
        seeded,
        status: seeded > 0 ? "seeded" : "already_up_to_date",
      },
      home_defaults: homeDefaults.results,
      database_path: getDbPath(),
      ...(savedHarnessPreference
        ? { harness_preference: savedHarnessPreference }
        : {}),
    });
    return;
  }

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
  } else {
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
  }

  if (savedHarnessPreference) {
    printInitMeta("Main Harness", savedHarnessPreference.main_harness);
    printInitMeta(
      "Aliases",
      savedHarnessPreference.alias_harnesses.join(", ") || "(none)",
    );
  }
}

async function handleHarnessSetCommand(opts: {
  main?: string;
  aliases?: string;
  interactive?: boolean;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const selection = await resolveHarnessSelection({
    main: opts.main,
    aliases: parseHarnessAliases(opts.aliases),
    nonInteractive: !opts.interactive,
    current: getHarnessPreference(),
  });
  const saved = setHarnessPreference(selection);
  log.success(`Saved harness preference: ${saved.main_harness}`);
}

function handleHarnessStatusCommand(opts: { format?: string }): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const preference = getHarnessPreference();
  if (format === "json") {
    printJson(
      preference ?? {
        main_harness: null,
        alias_harnesses: [],
      },
    );
    return;
  }
  if (!preference) {
    log.dim("No harness preference configured.");
    return;
  }
  console.log(`Main harness:   ${preference.main_harness}`);
  console.log(
    `Alias harnesses: ${preference.alias_harnesses.join(", ") || "(none)"}`,
  );
}

async function handleHarnessProjectSetCommand(opts: {
  project: string;
  main?: string;
  aliases?: string;
  materializationStrategy?: string;
  interactive?: boolean;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(opts.project);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    log.error("Not a git repository.");
    return;
  }

  const project = upsertProject({
    git_origin: normalizeGitUrl(gitOrigin),
    name: projectNameFromUrl(gitOrigin),
    local_path: projectRoot,
  });

  const selection = await resolveHarnessSelection({
    main: opts.main,
    aliases: parseHarnessAliases(opts.aliases),
    nonInteractive: !opts.interactive,
    current: getProjectHarnessConfig(project.id),
    detected: detectPlatforms(projectRoot),
  });

  const saved = setProjectHarnessConfig({
    project_id: project.id,
    main_harness: selection.main_harness,
    alias_harnesses: selection.alias_harnesses,
    ...(opts.materializationStrategy
      ? {
          materialization_strategy:
            opts.materializationStrategy === "copy" ? "copy" : "symlink-preferred",
        }
      : {}),
  });
  log.success(`Saved project harness preference: ${saved.main_harness}`);
}

function handleProjectDriftCommand(opts: {
  project: string;
  format?: string;
}): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    log.error("Not a git repository.");
    return;
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    if (format === "json") {
      printJson({
        project_root: projectRoot,
        snapshot_id: null,
        has_drift: false,
        changes: [],
        message: "No project record. Run project apply first.",
      });
      return;
    }
    log.warn("No project record found. Run `harnessdeck project apply` first.");
    return;
  }

  const report = detectProjectDriftFromLatest(projectRoot, project.id);
  if (!report) {
    return;
  }
  if (format === "json") {
    printJson(report);
    if (report.has_drift) process.exitCode = 1;
    return;
  }
  if (!report.snapshot_id) {
    log.dim("No snapshots found. Drift detection requires a prior apply or sync.");
    return;
  }
  if (!report.has_drift) {
    log.success("No drift detected since last snapshot.");
    return;
  }
  log.warn(
    `Drift detected (${report.changes.length} change(s)) since snapshot ${report.snapshot_id}`,
  );
  for (const change of report.changes) {
    log.info(`  ${change.type.padEnd(8)} ${change.path}`);
  }
  process.exitCode = 1;
}

function handlePresetDiffCommand(
  left: string,
  right: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const report = diffPresets(left, right);
    if (format === "json") {
      printJson(report);
      return;
    }
    log.info(`Diff: ${report.left} ↔ ${report.right}`);
    if (report.changes.length === 0) {
      log.success("No differences.");
      return;
    }
    for (const change of report.changes) {
      log.info(`  [${change.kind}] ${change.key}: ${change.change}`);
    }
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

function handlePresetValidateCommand(
  name: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const report = validatePreset(name);
  if (format === "json") {
    printJson(report);
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (report.valid && report.issues.length === 0) {
    log.success(`Preset "${report.preset}" is valid.`);
    return;
  }
  for (const issue of report.issues) {
    const label = issue.severity === "error" ? chalk.red("error") : chalk.yellow("warn");
    log.info(`  ${label} ${issue.code}: ${issue.message}`);
  }
  if (!report.valid) {
    process.exitCode = 1;
  }
}

async function handlePresetFromProjectCommand(
  name: string,
  opts: { project: string; description?: string; platform?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  try {
    const result = await createPresetFromProject({
      name,
      description: opts.description,
      projectRoot: resolve(opts.project),
      platform: opts.platform,
    });
    log.success(
      `Created preset "${result.preset.name}" with ${result.imported_count} resource(s)`,
    );
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

async function handleProjectSyncCommand(
  path: string,
  opts: {
    dryRun?: boolean;
    format?: string;
    forceShiftReference?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(path);
  try {
    const result = await syncProject({
      projectRoot,
      dryRun: opts.dryRun,
      forceShiftReference: opts.forceShiftReference,
    });
    if (format === "json") {
      printJson(result);
      return;
    }
    if (opts.dryRun) {
      log.dim("(dry run — no files written)");
    }
    log.success(
      `Synced ${result.platforms_synced.join(", ") || "(none)"} from main harness ${result.main_harness}`,
    );
    log.info(`Files written: ${result.files_written}`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

function handleMigrateExportCommand(
  file: string,
  opts: {
    includePlugins?: boolean;
    format?: string;
  },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const manifest = exportMigrationState({
      outputPath: file,
      includePlugins: opts.includePlugins,
    });
    if (format === "json") {
      printJson({ ...manifest, output: file });
      return;
    }
    log.success(`Exported migration archive to ${file}`);
    log.info(`Presets: ${manifest.preset_count}`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

function handleMigrateImportCommand(
  file: string,
  opts: { format?: string } = {},
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const result = importMigrationState({ archivePath: file });
    if (format === "json") {
      printJson(result);
      return;
    }
    log.success(
      `Imported ${result.presets_imported} preset(s) from migration archive`,
    );
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
  }
}

function handleHarnessProjectStatusCommand(opts: {
  project: string;
  format?: string;
}): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project);
  const gitOrigin = getGitOrigin(projectRoot);
  if (!gitOrigin) {
    log.error("Not a git repository.");
    return;
  }

  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  const config = project ? getProjectHarnessConfig(project.id) : undefined;

  if (format === "json") {
    printJson(
      config ?? {
        main_harness: null,
        alias_harnesses: [],
        materialization_strategy: "symlink-preferred",
      },
    );
    return;
  }

  if (!config) {
    log.dim("No project harness preference configured.");
    return;
  }

  console.log(`Main harness:   ${config.main_harness}`);
  console.log(
    `Alias harnesses: ${config.alias_harnesses.join(", ") || "(none)"}`,
  );
  console.log(
    `Materialization: ${config.materialization_strategy}`,
  );
}

// ── init ────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Initialize the harnessdeck database and config directory")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--main <slug>", "Default main harness slug")
  .option("--aliases <slugs>", "Comma-separated alias harness slugs")
  .option(
    "--interactive",
    "Prompt for harness selection instead of relying on explicit flags",
  )
  .action(async (opts: {
    format?: string;
    main?: string;
    aliases?: string;
    interactive?: boolean;
  }) => {
    await handleInitCommand(opts);
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
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const presets = listPresets();
    if (format === "json") {
      printJson(presets);
      return;
    }
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
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show preset details, resources, and plugin pins")
  .action((name: string, opts: { format?: string }) => {
    handlePresetShowCommand(name, opts);
  });

presetCmd
  .command("add")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource>", "Resource name or ID")
  .action((presetName: string, resourceSelector: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    const resourceResult = resolveResource(resourceSelector);
    if (resourceResult.status !== "found") {
      log.error(
        resourceResult.status === "ambiguous"
          ? `Ambiguous resource name: ${resourceSelector}`
          : `Resource not found: ${resourceSelector}`,
      );
      if (resourceResult.status === "ambiguous") {
        for (const match of resourceResult.matches) {
          log.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
        }
      }
      return;
    }
    addResourceToPreset(preset.id, resourceResult.resource.id);
    log.success(
      `Added resource ${resourceResult.resource.name} to preset ${preset.name}`,
    );
  });

presetCmd
  .command("remove")
  .argument("<preset>", "Preset name or ID")
  .argument("<resource>", "Resource name or ID")
  .action((presetName: string, resourceSelector: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    const resourceResult = resolveResource(resourceSelector);
    if (resourceResult.status !== "found") {
      log.error(
        resourceResult.status === "ambiguous"
          ? `Ambiguous resource name: ${resourceSelector}`
          : `Resource not found: ${resourceSelector}`,
      );
      if (resourceResult.status === "ambiguous") {
        for (const match of resourceResult.matches) {
          log.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
        }
      }
      return;
    }
    removeResourceFromPreset(preset.id, resourceResult.resource.id);
    log.success(
      `Removed resource ${resourceResult.resource.name} from preset ${preset.name}`,
    );
  });

presetCmd
  .command("add-plugin")
  .argument("<preset>", "Preset name or ID")
  .argument("<ref>", "Plugin ref (e.g. formatter@marketplace)")
  .requiredOption(
    "--version <constraint>",
    "Version constraint (semver version or valid range)",
  )
  .description("Pin a plugin version constraint on a preset")
  .action(
    (
      presetName: string,
      ref: string,
      opts: { version: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const preset = getPreset(presetName);
      if (!preset) {
        log.error(`Preset not found: ${presetName}`);
        return;
      }
      try {
        parseVersionConstraint(opts.version);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        return;
      }
      addPluginToPreset(preset.id, ref, opts.version);
      syncClaudePresetPluginsAfterAdd(preset, ref, opts.version);
      log.success(
        `Added plugin pin ${ref} (${opts.version}) to preset ${preset.name}`,
      );
    },
  );

presetCmd
  .command("remove-plugin")
  .argument("<preset>", "Preset name or ID")
  .argument("<ref>", "Plugin ref to unpin")
  .description("Remove a plugin pin from a preset")
  .action((presetName: string, ref: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetName);
    if (!preset) {
      log.error(`Preset not found: ${presetName}`);
      return;
    }
    removePluginFromPreset(preset.id, ref);
    syncClaudePresetPluginsAfterRemove(preset, ref);
    log.success(`Removed plugin pin ${ref} from preset ${preset.name}`);
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
  .option(
    "--embed-plugins",
    "Also inline Claude marketplace-installed plugin trees when their install paths resolve from HOME",
  )
  .description("Export a preset as a shareable JSON bundle")
  .action(handlePresetExportCommand);

presetCmd
  .command("import")
  .argument("<file>", "JSON bundle file to import")
  .description("Import a preset from a JSON bundle file")
  .action(handlePresetImportCommand);

presetCmd
  .command("diff")
  .argument("<left>", "Preset name or bundle file")
  .argument("<right>", "Preset name or bundle file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two presets or a preset and a bundle file")
  .action(handlePresetDiffCommand);

presetCmd
  .command("validate")
  .argument("<name>", "Preset name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Validate a preset without applying it to a project")
  .action(handlePresetValidateCommand);

presetCmd
  .command("from-project")
  .argument("<name>", "New preset name")
  .option("--project <path>", "Project directory", ".")
  .option("-d, --description <text>", "Preset description")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .description("Scan a project and create a preset from imported resources")
  .action(handlePresetFromProjectCommand);

// ── migrate ─────────────────────────────────────────────────────────────

const migrateCmd = program
  .command("migrate")
  .description("Export or import full HarnessDeck state for machine migration");
migrateCmd.helpCommand(false);

migrateCmd
  .command("export")
  .argument("<file>", "Output archive path (.tar.gz or .json)")
  .option("--include-plugins", "Embed plugin trees in preset bundles")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Export all presets, harness preferences, and config")
  .action(handleMigrateExportCommand);

migrateCmd
  .command("import")
  .argument("<file>", "Migration archive from migrate export")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Import a migration archive on this machine")
  .action(handleMigrateImportCommand);

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
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { type?: string; search?: string; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const type = opts.type as ResourceType | undefined;
    if (type && !RESOURCE_TYPES.includes(type)) {
      log.error(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    const resources = listResources({ type, search: opts.search });
    if (format === "json") {
      printJson(resources);
      return;
    }
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
  .option("--format <mode>", "Output format: human or json", "human")
  .action((resource: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const result = resolveResource(resource);
    if (result.status === "ambiguous" && format === "json") {
      printJson({
        error: "ambiguous_resource_name",
        input: resource,
        matches: result.matches,
      });
      return;
    }
    if (result.status === "found" && format === "json") {
      printJson(result.resource);
      return;
    }
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
  .argument(
    "<presets...>",
    "Preset name(s), bundle path, or URL (multiple presets are merged in order)",
  )
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .option("--dry-run", "Show what would be written")
  .option("--format <mode>", "Output format: human or json", "human")
  .option(
    "--ignore-plugin-versions",
    "Skip validating preset Claude plugin pins against installed versions",
  )
  .option(
    "--strict-plugin-versions",
    "Fail apply (exit 2) if any pinned plugin violates its version constraint",
  )
  .description(
    "Apply one or more presets (or a bundle URL) to a project, serializing for each platform",
  )
  .action(handleApplyCommand);

projectCmd
  .command("drift")
  .option("--project <path>", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "Detect drift between project files and the latest apply/sync snapshot",
  )
  .action(handleProjectDriftCommand);

projectCmd
  .command("sync")
  .argument("[path]", "Project directory", ".")
  .option("--dry-run", "Show what would be written without writing files")
  .option(
    "--force-shift-reference <slug>",
    "Set the project main harness before syncing",
  )
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "Sync alias harness outputs from the main harness on-disk configuration",
  )
  .action(handleProjectSyncCommand);

projectCmd
  .command("history")
  .option("--project <path>", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
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
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show current project status")
  .action(async (path: string, opts: { format?: string }) => {
    await handleProjectStatusCommand(path, opts);
  });

// ── platform ────────────────────────────────────────────────────────────

const platformCmd = program
  .command("platform")
  .description("Inspect supported platforms (target coding assistants or formats like Claude Code, Cursor, or Codex)");
platformCmd.helpCommand(false);
platformCmd.helpCommand(false);

platformCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "List all supported platforms (e.g., Claude Code, Cursor, Codex)",
  )
  .action(handlePlatformListCommand);

// ── harness ─────────────────────────────────────────────────────────────

const harnessCmd = program
  .command("harness")
  .description("Manage harness preferences for main and alias platforms");
harnessCmd.helpCommand(false);

harnessCmd
  .command("set")
  .option("--main <slug>", "Main harness slug")
  .option("--aliases <slugs>", "Comma-separated alias harness slugs")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Set global harness preferences")
  .action(handleHarnessSetCommand);

harnessCmd
  .command("status")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show global harness preferences")
  .action(handleHarnessStatusCommand);

const harnessProjectCmd = harnessCmd
  .command("project")
  .description("Manage harness preferences for a git-backed project");
harnessProjectCmd.helpCommand(false);

harnessProjectCmd
  .command("set")
  .option("--project <path>", "Project directory", ".")
  .option("--main <slug>", "Main harness slug")
  .option("--aliases <slugs>", "Comma-separated alias harness slugs")
  .option(
    "--materialization-strategy <strategy>",
    "Materialization strategy: symlink-preferred or copy",
  )
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Set project-scoped harness preferences")
  .action(handleHarnessProjectSetCommand);

harnessProjectCmd
  .command("status")
  .option("--project <path>", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show project-scoped harness preferences")
  .action(handleHarnessProjectStatusCommand);

// ── plugin ──────────────────────────────────────────────────────────────

const pluginCmd = program
  .command("plugin")
  .description("Plugin inventory and lifecycle");
pluginCmd.helpCommand(false);

pluginCmd
  .command("list")
  .alias("ls")
  .argument("[path]", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "List Claude Code plugin inventory (project-committed vs merged effective)",
  )
  .action(handlePluginInventoryListCommand);

pluginCmd
  .command("show")
  .argument("<ref>", "Plugin ref (e.g. formatter@acme-marketplace)")
  .argument("[path]", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "Show merged effective install and settings scopes that declare this ref",
  )
  .action(handlePluginInventoryShowCommand);

pluginCmd
  .command("installed")
  .argument("[path]", "Project directory", ".")
  .option("-p, --platform <slugs>", "Comma-separated platform slugs")
  .option("--format <mode>", "Output format: human or json", "human")
  .description(
    "List plugins as reported by providers (lifecycle / check-update tooling)",
  )
  .action(handlePluginInstalledListCommand);

pluginCmd
  .command("check")
  .argument("[path]", "Project directory", ".")
  .option("-p, --platform <slugs>", "Comma-separated platform slugs")
  .option("--scope <scopes>", "Comma-separated scopes: user,project,local,managed")
  .option("--refresh", "Force refresh marketplace/git metadata before check")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Check for outdated plugins")
  .action(handlePluginCheckCommand);

pluginCmd
  .command("update")
  .argument("[ref]", "Plugin ref (e.g. superpowers@claude-plugins-official)")
  .option("-p, --platform <slugs>", "Comma-separated platform slugs")
  .option("--scope <scopes>", "Comma-separated scopes")
  .option("--all", "Update all outdated plugins")
  .option("--yes", "Confirm managed-scope updates")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Update one or more plugins")
  .action(handlePluginUpdateCommand);

pluginCmd
  .command("refresh")
  .option("-p, --platform <slugs>", "Comma-separated platform slugs")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Force refresh plugin source metadata")
  .action(handlePluginRefreshCommand);

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
  .option("--format <mode>", "Output format: human or json", "human")
  .option(
    "--ignore-plugin-versions",
    "Skip validating preset Claude plugin pins against installed versions",
  )
  .option(
    "--strict-plugin-versions",
    "Fail apply (exit 2) if any pinned plugin violates its version constraint",
  )
  .action(
    async (
      presetName: string,
      opts: {
        project: string;
        platform?: string;
        dryRun?: boolean;
        format?: string;
        ignorePluginVersions?: boolean;
        strictPluginVersions?: boolean;
      },
    ) => {
      warnDeprecatedCommand("harnessdeck apply", "harnessdeck project apply");
      await handleApplyCommand([presetName], opts);
    },
  );

program
  .command("history", { hidden: true })
  .option("--project <path>", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { project: string; format?: string }) => {
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
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (path: string, opts: { format?: string }) => {
    warnDeprecatedCommand("harnessdeck status", "harnessdeck project status");
    await handleProjectStatusCommand(path, opts);
  });

program
  .command("export", { hidden: true })
  .argument("<preset>", "Preset name or ID")
  .option("-f, --file <path>", "Output file path")
  .option(
    "--embed-plugins",
    "Also inline Claude marketplace-installed plugin trees when their install paths resolve from HOME",
  )
  .action((presetName: string, opts: { file?: string; embedPlugins?: boolean }) => {
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
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    warnDeprecatedCommand("harnessdeck platforms", "harnessdeck platform list");
    handlePlatformListCommand(opts);
  });


// ── cleanup ─────────────────────────────────────────────────────────────

process.on("exit", () => closeDb());

await program.parseAsync();
