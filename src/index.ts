import { Command } from "commander";
import { getDb, closeDb, getDbPath } from "./db/connection.js";
import { initializeSchema } from "./db/schema.js";
import { ui } from "./ui/index.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "./services/git.js";
import {
  scanProject,
  persistScanResults,
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
import { basename, resolve } from "node:path";
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
import { createProgress } from "./ui/progress.js";

const program = new Command();

function resolveInvocationName(): "harnessdeck" | "hd" {
  return basename(process.argv[1] ?? "") === "hd" ? "hd" : "harnessdeck";
}

const invocationName = resolveInvocationName();

function formatCommand(path: string): string {
  return `${invocationName} ${path}`.trim();
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
  ui.warn(
    `\`${legacyCommand}\` is deprecated; use \`${replacementCommand}\` instead.`,
  );
}

function renderGroupedCommandHelp(
  cmd: Command,
  showHidden: boolean,
): string {
  const commands = cmd.commands.filter((c) => {
    const hidden = (c as { _hidden?: boolean })._hidden;
    return showHidden || !hidden;
  });
  
  if (commands.length === 0) {
    return "";
  }

  const lines: string[] = [];
  
  // Calculate max length for alignment
  const commandStrs = commands.map((c) => {
    const name = c.name();
    const aliases = c.aliases();
    const args = c.registeredArguments?.map((arg) => {
      if (arg.required) {
        return `<${arg.name()}>`;
      }
      return `[${arg.name()}]`;
    }).join(" ") || "";
    
    const hasOptions = c.options.filter((opt) => !opt.hidden).length > 0;
    
    let fullStr = name;
    if (aliases.length) {
      fullStr += ` (${aliases.join(", ")})`;
    }
    if (hasOptions || args) {
      fullStr += " ";
      if (hasOptions) fullStr += "[options]";
      if (hasOptions && args) fullStr += " ";
      if (args) fullStr += args;
    }
    
    return fullStr;
  });
  
  const maxNameLength = commandStrs.length > 0 ? Math.max(...commandStrs.map((s) => s.length)) : 0;

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const nameStr = commandStrs[i];
    if (!command || !nameStr) continue;
    const padding = " ".repeat(Math.max(2, maxNameLength - nameStr.length + 2));
    const desc = command.description() || "";
    lines.push(`  ${ui.theme.accent(nameStr)}${padding}${desc}`);
  }

  return lines.join("\n");
}

program
  .name(invocationName)
  .description(
    "Preset-based AI coding assistant configuration manager for Claude Code, Codex, Cursor, and other coding CLIs",
  )
  .version("0.1.0", "-V, --harnessdeck-version")
  .option("--no-color", "Disable color output")
  .option("--show-hidden", "Show all commands including hidden ones (use with --help)")
  .helpCommand(false)
  .hook("preAction", (command) => {
    const opts = command.optsWithGlobals<{ color?: boolean }>();
    if (opts.color === false) {
      ui.disableColor();
    }
  })
  .configureHelp({
    formatHelp: (cmd) => {
      // Check for --no-color early before rendering help
      if (process.argv.includes("--no-color")) {
        ui.disableColor();
      }
      
      const showHidden = process.argv.includes("--show-hidden");
      const isTopLevel = cmd.name() === invocationName;
      
      if (!isTopLevel) {
        const lines = [
          "",
          ui.theme.muted("USAGE"),
          `  ${cmd.name()} ${cmd.usage()}`,
          "",
        ];
        
        if (cmd.description()) {
          lines.push(cmd.description(), "");
        }
        
        const opts = cmd.options.filter((opt) => !opt.hidden);
        if (opts.length > 0) {
          lines.push(ui.theme.muted("OPTIONS"));
          for (const opt of opts) {
            const flags = opt.flags;
            const desc = opt.description || "";
            lines.push(`  ${ui.theme.accent(flags)}  ${desc}`);
          }
          lines.push("");
        }
        
        const subcommands = renderGroupedCommandHelp(cmd, showHidden);
        if (subcommands) {
          lines.push(ui.theme.muted("COMMANDS"));
          lines.push(subcommands);
          lines.push("");
        }
        
        return lines.join("\n");
      }
      
      const lines = [
        "",
        ui.theme.primary(invocationName),
        "Preset-based AI coding assistant configuration manager",
        "",
        ui.theme.muted("USAGE"),
        `  ${invocationName} [options] [command]`,
        "",
        ui.theme.muted("OPTIONS"),
        `  ${ui.theme.accent("-V, --harnessdeck-version")}  output the version number`,
        `  ${ui.theme.accent("--no-color")}               disable color output`,
        `  ${ui.theme.accent("--show-hidden")}            show all commands including hidden ones`,
        `  ${ui.theme.accent("-h, --help")}               display help for command`,
        "",
        ui.theme.muted("COMMANDS"),
        renderGroupedCommandHelp(cmd, showHidden),
        "",
      ];
      
      return lines.join("\n");
    },
  });

async function handleScanCommand(
  path: string,
  opts: { platform?: string; dryRun?: boolean },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);

  const detected = detectPlatforms(projectRoot);
  if (detected.length === 0) {
    ui.warn("No coding CLI configurations detected in this directory.");
    return;
  }
  const scannedPlatformIds = opts.platform ? [opts.platform] : detected;

  if (opts.dryRun) {
    const results = await scanProject(projectRoot, opts.platform);
    for (const result of results) {
      const count = result.resources.length;
      const dryTag = ui.theme.muted("[dry run] ");
      const verdict = ui.theme.success(
        `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${formatCount(count, "resource")}`,
      );
      console.log(dryTag + verdict);
      for (const resource of result.resources) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
      }
    }
    return;
  }

  const spin = createProgress("Scanning…");
  const results = await scanProject(projectRoot, opts.platform);
  const persisted = persistScanResults(results);
  spin.stop();

  for (const result of results) {
    const importedCount = persisted.importedCounts.get(result.platformId) ?? 0;
    ui.success(`${result.platformId} ${ui.icons.bullet} ${formatCount(importedCount, "resource")}`);
    for (const resource of result.resources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
    }
  }

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
      ui.hint(
        `${formatCount(pluginSummary.installs.length, "plugin")} installed (${formatCount(check.summary.outdated, "outdated")})`,
      );
    }
  } catch {
    // Plugin scan is best-effort during project scan
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
  ui.success(`Project registered: ${name} (${normalized})`);

  try {
    const inventorySummary = await persistClaudePluginInventoryForProject({
      projectRoot,
      projectId: registered.id,
      scannedPlatformIds,
      homeRoot: homedir(),
    });
    if (inventorySummary) {
      ui.hint(
        `claude-code plugins: ${inventorySummary.committed_count} committed, ${inventorySummary.effective_count} effective`,
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
    ui.danger("Provide at least one preset name, bundle path, or URL.");
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
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  const primaryPreset = applyBundle.presets[applyBundle.presets.length - 1];
  if (!primaryPreset) {
    ui.danger("No preset resolved for apply");
    return;
  }

  const platforms = opts.platform
    ? opts.platform.split(",")
    : detectPlatforms(projectRoot);

  if (platforms.length === 0) {
    ui.warn("No platforms detected. Use --platform to specify.");
    return;
  }

  const { resources, claude } = applyBundle;
  const generated = await generateFiles(
    resources,
    platforms,
    projectRoot,
    claude,
  );

  // Strict plugin validation must happen BEFORE any files are written.
  if (
    !opts.dryRun &&
    opts.strictPluginVersions &&
    !opts.ignorePluginVersions &&
    listPresetPlugins(applyBundle.primaryPresetId).length > 0
  ) {
    const inventory = await refreshClaudePluginInventoryForCli(projectRoot);
    const issues = validatePresetPluginConstraints(
      applyBundle.primaryPresetId,
      inventory,
    );
    if (issues.length > 0) {
      for (const issue of issues) {
        console.warn(ui.theme.warn(issue.message));
      }
      ui.danger("Plugin pin violations — apply aborted");
      process.exitCode = 2;
      return;
    }
  }

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
    for (const result of generated) {
      const dryTag = ui.theme.muted("[dry run] ");
      const verdict = ui.theme.success(
        `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${formatCount(result.files.length, "file")}`,
      );
      console.log(dryTag + verdict);
      for (const file of result.files) {
        console.log(ui.theme.muted(`  ${ui.icons.bullet} ${file.path}`));
      }
    }
    return;
  }

  // Write files with per-platform progress handles.
  for (const result of generated) {
    const spin = createProgress(`Applying ${result.platformId}…`);
    writeFiles(result.files, projectRoot);
    spin.succeed(
      `${result.platformId} ${ui.icons.bullet} wrote ${formatCount(result.files.length, "file")}`,
    );
    for (const file of result.files) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${file.path}`));
    }
  }

  // Non-strict plugin warnings (shown after successful file writes).
  if (
    !opts.ignorePluginVersions &&
    !opts.strictPluginVersions &&
    listPresetPlugins(applyBundle.primaryPresetId).length > 0
  ) {
    const inventory = await refreshClaudePluginInventoryForCli(projectRoot);
    const issues = validatePresetPluginConstraints(
      applyBundle.primaryPresetId,
      inventory,
    );
    for (const issue of issues) {
      console.warn(ui.theme.warn(issue.message));
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
    ui.danger("Not a git repository.");
    return;
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  if (!project) {
    if (format === "json") {
      printJson({ snapshots: [] });
      return;
    }
    ui.warn(`No project record found. Run \`${formatCommand("project scan")}\` first.`);
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
  const rows = snapshots.map((s) => ({
    when: s.created_at,
    id: s.id,
    label: s.label ?? "",
  }));
  ui.table.print({
    columns: [
      { key: "when", header: "WHEN", width: 16, transform: (value) => ui.format.formatRelativeTime(String(value)) },
      { key: "id", header: "ID", width: 14, transform: (value) => ui.format.shortenId(String(value)) },
      { key: "label", header: "LABEL", width: 36 },
    ],
    rows,
    summary: `${rows.length} snapshots`,
  });
}

function handleRevertCommand(snapshotId?: string): void {
  const db = getDb();
  initializeSchema(db);
  if (!snapshotId) {
    ui.danger(
      `Please provide a snapshot ID. Use \`${formatCommand("project history")}\` to list them.`,
    );
    return;
  }
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    ui.danger(`Snapshot not found: ${snapshotId}`);
    return;
  }
  const project = getProject(snapshot.project_id);
  if (!project) {
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

function handlePresetExportCommand(
  presetName: string,
  opts: { file?: string; embedPlugins?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const filePath = opts.file ?? `${presetName}.harnessdeck.json`;
  exportToFile(presetName, filePath, { embedPlugins: opts.embedPlugins });
  ui.success(`Exported preset ${ui.theme.accent(presetName)} ${ui.icons.hint} ${filePath}`);
}

function handlePresetImportCommand(file: string): void {
  const db = getDb();
  initializeSchema(db);
  const { preset, resources } = importFromFile(file);
  ui.success(
    `Imported preset ${ui.theme.accent(preset.name)} ${ui.icons.bullet} ${formatCount(resources.length, "resource")}`,
  );
}

function handlePlatformListCommand(opts: { format?: string } = {}): void {
  const format = parseOutputFormat(opts.format);
  const platforms = getAllPlatforms();
  if (format === "json") {
    printJson(platforms);
    return;
  }
  const rows = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    supports: [...p.supports].join(", "),
  }));
  ui.table.print({
    columns: [
      { key: "id", header: "ID", width: 20 },
      { key: "name", header: "NAME", width: 20 },
      { key: "supports", header: "SUPPORTS", width: 40 },
    ],
    rows,
    summary: `${platforms.length} platforms`,
    empty: "No platforms found.",
  });
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
    ui.danger(`Preset not found: ${name}`);
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

  ui.panel({
    title: ["PRESET", preset.name],
    rows: [
      ["Description", preset.description || "—"],
      ["Tags", preset.tags.length > 0 ? preset.tags.join(", ") : "—"],
      ["ID", ui.format.shortenId(preset.id)],
      ["Resources", `${resources.length} (${summarizeResourceTypes(resources) || "none"})`],
      ["Plugins", plugins.length === 0 ? "(none pinned)" : `${plugins.length}`],
      ["Updated", ui.format.formatRelativeTime(preset.updated_at)],
    ],
  });

  ui.subheader("RESOURCES");
  ui.table.print({
    columns: [
      { key: "type", header: "TYPE", width: 14 },
      { key: "name", header: "NAME", width: 26 },
      { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
    ],
    rows: resources,
    empty: "No resources in this preset.",
  });

  if (plugins.length > 0) {
    ui.subheader("PLUGINS");
    ui.table.print({
      columns: [
        { key: "ref", header: "REF", width: 36 },
        { key: "version_constraint", header: "CONSTRAINT", width: 20 },
      ],
      rows: plugins,
    });
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

  ui.subheader("COMMITTED");
  ui.table.print({
    columns: [
      { key: "ref", header: "REF", width: 42 },
      { key: "version", header: "VERSION", width: 14 },
      { key: "enabled", header: "ENABLED", width: 8, transform: (v) => (v === "true" ? "yes" : "no") },
    ],
    rows: committed,
    empty: "(none)",
  });

  ui.subheader("EFFECTIVE");
  ui.table.print({
    columns: [
      { key: "ref", header: "REF", width: 42 },
      { key: "version", header: "VERSION", width: 14 },
      { key: "enabled", header: "ENABLED", width: 8, transform: (v) => (v === "true" ? "yes" : "no") },
      { key: "scope", header: "SCOPE", width: 12 },
    ],
    rows: effective,
    empty: "(none)",
  });
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

  if (install == null) {
    ui.panel({
      title: ["PLUGIN", ref],
      rows: [
        ["Ref", ref],
        ["Declared by scopes", declaredScopes.length > 0 ? declaredScopes.join(", ") : "(none)"],
        ["Effective install", ui.theme.warn("(not found in merged inventory)")],
      ],
    });
    return;
  }

  ui.panel({
    title: ["PLUGIN", ref],
    rows: [
      ["Ref", ref],
      ["Declared by scopes", declaredScopes.length > 0 ? declaredScopes.join(", ") : "(none)"],
      ["Platform", install.platformId],
      ["Version", install.version],
      ["Enabled", install.enabled ? "yes" : "no"],
      ["Scope", install.scope],
      ...(install.installPath ? [["Path", install.installPath] as [string, string]] : []),
    ],
  });
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
  const rows = result.installs.map((install) => ({
    platform: install.platformId,
    ref: install.ref,
    version: install.version,
    scope: install.scope,
  }));
  ui.table.print({
    columns: [
      { key: "platform", header: "PLATFORM", width: 14 },
      { key: "ref", header: "REF", width: 36 },
      { key: "version", header: "VERSION", width: 14 },
      { key: "scope", header: "SCOPE", width: 10 },
    ],
    rows,
    summary: rows.length === 0 ? undefined : `${rows.length} plugins`,
    empty: "No plugins found.",
  });
  if (result.unsupported_platforms.length > 0) {
    ui.dim(`Unsupported platforms: ${result.unsupported_platforms.join(", ")}`);
  }
}

async function handlePluginCheckCommand(
  path: string,
  opts: { platform?: string; scope?: string; refresh?: boolean; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);

  // When --refresh is requested in human mode, use spinner + verdict instead of table.
  if (opts.refresh && format === "human") {
    const spin = createProgress("Checking plugins…");
    const report = await checkPlugins({
      ...pluginLifecycleBase(path, opts),
      scopes: parseScopeFilter(opts.scope),
      forceRefresh: true,
    });
    const outdated = report.summary.outdated;
    const verdictMsg = `Refreshed ${formatCount(report.refreshed_sources.length, "source")} ${ui.icons.bullet} ${report.summary.current} current, ${outdated} outdated`;
    if (outdated > 0) {
      spin.fail(verdictMsg);
    } else {
      spin.succeed(verdictMsg);
    }
    for (const source of report.refreshed_sources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${source}`));
    }
    if (outdated > 0) process.exitCode = 1;
    return;
  }

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
  const rows = report.results.map((row) => ({
    status: row.status,
    platform: row.platformId,
    ref: row.ref,
    version: row.version,
    latest: row.status === "outdated" && row.latestVersion ? row.latestVersion : row.version,
    scope: row.scope,
  }));
  ui.table.print({
    columns: [
      {
        key: "status",
        header: "STATUS",
        width: 10,
        style: (value) =>
          value === "outdated"
            ? ui.theme.warn(value)
            : value === "current"
              ? ui.theme.success(value)
              : ui.theme.muted(value),
      },
      { key: "platform", header: "PLATFORM", width: 14, style: (value) => ui.theme.muted(value) },
      { key: "ref", header: "REF", width: 28 },
      { key: "version", header: "VERSION", width: 12 },
      { key: "latest", header: "LATEST", width: 12 },
      { key: "scope", header: "SCOPE", width: 10 },
    ],
    rows,
    summary: `${rows.length} plugins ${ui.icons.bullet} ${report.summary.current} current ${ui.icons.bullet} ${report.summary.outdated} outdated ${ui.icons.bullet} ${report.summary.unknown} unknown`,
    empty: "No plugins found.",
  });
  if (report.unsupported_platforms.length > 0) {
    ui.dim(`Unsupported platforms: ${report.unsupported_platforms.join(", ")}`);
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
  if (format === "json") {
    const report = await updatePlugins({
      ...pluginLifecycleBase(".", opts),
      ref,
      all: opts.all,
      yes: opts.yes,
      scopes: parseScopeFilter(opts.scope),
    });
    printJson(report);
    if (report.summary.failed > 0) process.exitCode = 1;
    return;
  }

  const spin = createProgress("Updating plugins…");
  const report = await updatePlugins({
    ...pluginLifecycleBase(".", opts),
    ref,
    all: opts.all,
    yes: opts.yes,
    scopes: parseScopeFilter(opts.scope),
  });

  if (report.results.length === 0) {
    spin.stop();
    ui.info("No plugins to update.");
  } else {
    const updatedCount = report.summary.updated;
    const failedCount = report.summary.failed;
    const verdictMsg =
      failedCount > 0
        ? `${formatCount(updatedCount, "plugin")} updated, ${formatCount(failedCount, "failed")}`
        : `${formatCount(updatedCount, "plugin")} updated`;
    if (failedCount > 0) {
      spin.fail(verdictMsg);
    } else {
      spin.succeed(verdictMsg);
    }
    for (const row of report.results) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${row.ref}: ${row.status} — ${row.message}`));
    }
  }
  if (report.summary.failed > 0) process.exitCode = 1;
}

async function handlePluginRefreshCommand(
  opts: { platform?: string; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  if (format === "human") {
    const spin = createProgress("Refreshing plugin sources…");
    const result = await refreshPluginSources(pluginLifecycleBase(".", opts));
    spin.succeed(
      `Refreshed ${formatCount(result.refreshed_sources.length, "source")}`,
    );
    for (const source of result.refreshed_sources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${source}`));
    }
    return;
  }
  const result = await refreshPluginSources(pluginLifecycleBase(".", opts));
  printJson(result);
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
    ui.panel({
      title: ["PROJECT"],
      rows: [
        ["Root", projectRoot],
        ["Git origin", "(none)"],
        ["Platforms", detected.join(", ") || "(none detected)"],
        ["Plugins", "(not tracked — no git origin)"],
      ],
    });
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

  let pluginsLine = "(none detected)";
  try {
    const plugins = await listPlugins({ projectRoot, homeRoot: homedir() });
    if (plugins.installs.length > 0) {
      const check = await checkPlugins({ projectRoot, homeRoot: homedir() });
      pluginsLine = `${plugins.installs.length} installed (${check.summary.outdated} outdated)`;
    }
  } catch {
    // best-effort
  }

  if (detected.includes("claude-code") && project) {
    const inventory = getProjectPluginState(project.id);
    if (inventory) {
      pluginsLine = `${inventory.committed.length} committed, ${inventory.effective.length} effective`;
    }
  }

  const rows: [string, string][] = [
    ["Root", projectRoot],
    ["Git origin", gitOrigin],
    ["Platforms", detected.join(", ") || "(none detected)"],
  ];
  if (project) {
    rows.push(["Applied presets", `${presets.length}`]);
    rows.push(["Snapshots", `${snapshots.length}`]);
  }
  rows.push(["Plugins", pluginsLine]);

  ui.panel({ title: ["PROJECT"], rows });
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

  ui.success("Harnessdeck initialized");
  console.log("");
  ui.kvBlock([
    { key: "Database", value: getDbPath() },
    {
      key: "Built-in Presets",
      value:
        seeded > 0
          ? `seeded ${formatCount(seeded, "built-in preset")}`
          : "already up to date",
    },
  ]);

  if (homeDefaults.detected.length === 0) {
    console.log("");
    ui.dim("no default folders discovered");
  } else {
    console.log("");
    ui.subheader("HOME DEFAULTS");
    console.log("");
    for (const result of homeDefaults.results) {
      const folder = homeFolderLabel(result.discoveredPaths);
      const foundSummary = summarizeResourceTypes(result.resources);
      const importedCount = result.importedCount;
      const importedSummary =
        importedCount > 0
          ? `${formatCount(importedCount, "new resource")} imported`
          : "already tracked";

      const platformName = platformNames.get(result.platformId) ?? result.platformId;
      console.log(
        `  ${ui.theme.badge(platformName)} ${ui.theme.accent(folder)}`,
      );
      ui.kvBlock([
        {
          key: "Contains",
          value: relativeDiscoveredPaths(result.discoveredPaths, folder),
        },
        {
          key: "Found",
          value: `${formatCount(result.resources.length, "resource")}${foundSummary ? ` (${foundSummary})` : ""}`,
        },
        {
          key: "Status",
          value: importedCount > 0 ? ui.theme.warn(importedSummary) : ui.theme.success(importedSummary),
        },
      ], { indent: 4, keyWidth: 10 });
    }
  }

  if (savedHarnessPreference) {
    console.log("");
    ui.kvBlock([
      { key: "MAIN HARNESS", value: savedHarnessPreference.main_harness },
      {
        key: "ALIASES",
        value: savedHarnessPreference.alias_harnesses.join(", ") || "(none)",
      },
    ], { keyWidth: 14 });
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
  ui.success(`Set harness preference ${ui.icons.hint} main: ${ui.theme.accent(saved.main_harness)}`);
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
    ui.dim("No harness preference configured.");
    return;
  }
  ui.panel({
    title: ["HARNESS"],
    rows: [
      ["Main harness", preference.main_harness],
      ["Alias harnesses", preference.alias_harnesses.join(", ") || "(none)"],
    ],
  });
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
    ui.danger("Not a git repository.");
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
  ui.success(`Set project harness preference ${ui.icons.hint} main: ${ui.theme.accent(saved.main_harness)}`);
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
    ui.danger("Not a git repository.");
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
        message: `No project record. Run ${formatCommand("project apply")} first.`,
      });
      return;
    }
    ui.warn(`No project record found. Run \`${formatCommand("project apply")}\` first.`);
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
    ui.dim("No snapshots found. Drift detection requires a prior apply or sync.");
    return;
  }
  if (!report.has_drift) {
    ui.success("No drift detected since last snapshot.");
    return;
  }
  console.log(`DRIFT  ${projectRoot}`);
  console.log("");
  const changeEntries = report.changes.map((c) => ({
    // Drift reports "deleted", but the shared renderer vocabulary uses "removed".
    kind:
      c.type === "deleted"
        ? ("removed" as const)
        : c.type,
    scope: c.type,
    key: c.path,
    detail: c.platform ?? "",
  }));
  console.log(ui.renderChangeList(changeEntries));
  console.log("");
  console.log(
    `${report.changes.length} change(s) since snapshot ${report.snapshot_id}`,
  );
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
    if (report.changes.length === 0) {
      ui.success("No differences.");
      return;
    }

    const changeEntries = report.changes.map((c) => ({
      kind: (c.change === "reordered" ? "modified" : c.change) as "added" | "removed" | "modified",
      scope: c.kind,
      key: c.key,
      detail: c.change,
    }));

    const added = changeEntries.filter((c) => c.kind === "added").length;
    const removed = changeEntries.filter((c) => c.kind === "removed").length;
    const modified = changeEntries.filter((c) => c.kind === "modified").length;

    console.log(`DIFF  ${report.left} ↔ ${report.right}`);
    console.log("");
    console.log(ui.renderChangeList(changeEntries));
    console.log("");
    console.log(
      `${report.changes.length} changes ${ui.icons.bullet} ${added} added ${ui.icons.bullet} ${removed} removed ${ui.icons.bullet} ${modified} modified`,
    );
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
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
    ui.success(`Preset "${report.preset}" is valid.`);
    return;
  }
  ui.table.print({
    columns: [
      { key: "severity", header: "SEVERITY", width: 10 },
      { key: "code", header: "CODE", width: 28 },
      { key: "message", header: "MESSAGE", width: 40 },
    ],
    rows: report.issues,
    summary: report.valid ? `${report.preset}: valid (warnings only)` : `${report.preset}: invalid`,
  });
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
    ui.success(
      `Created preset ${ui.theme.accent(result.preset.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
    );
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
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
    const result = await (async () => {
      if (format === "human" && !opts.dryRun) {
        const spin = createProgress("Syncing…");
        const r = await syncProject({
          projectRoot,
          dryRun: false,
          forceShiftReference: opts.forceShiftReference,
        });
        spin.succeed(
          `Synced ${r.platforms_synced.join(", ") || "(none)"} from ${r.main_harness} ${ui.icons.bullet} ${formatCount(r.files_written, "file")}`,
        );
        return r;
      }
      return syncProject({
        projectRoot,
        dryRun: opts.dryRun,
        forceShiftReference: opts.forceShiftReference,
      });
    })();
    if (format === "json") {
      printJson(result);
      return;
    }
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
    ui.success(`Exported migration archive ${ui.icons.hint} ${file} ${ui.icons.bullet} ${manifest.preset_count} presets`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
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
    ui.success(
      `Imported migration archive ${ui.icons.bullet} ${formatCount(result.presets_imported, "preset")}`,
    );
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
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
    ui.danger("Not a git repository.");
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
    ui.dim("No project harness preference configured.");
    return;
  }

  ui.panel({
    title: ["HARNESS", "project"],
    rows: [
      ["Main harness", config.main_harness],
      ["Alias harnesses", config.alias_harnesses.join(", ") || "(none)"],
      ["Materialization", config.materialization_strategy],
    ],
  });
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
      ui.success(`Created preset ${ui.theme.accent(preset.name)}`);
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
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 18 },
        { key: "description", header: "DESCRIPTION", width: 44, transform: (value) => value || "—" },
      ],
      rows: presets,
      summary: `${presets.length} presets ${ui.icons.bullet} run \`${formatCommand("preset show <name>")}\` for details`,
      empty: "No presets found.",
    });
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
      ui.danger(`Preset not found: ${presetName}`);
      return;
    }
    const resourceResult = resolveResource(resourceSelector);
    if (resourceResult.status !== "found") {
      ui.danger(
        resourceResult.status === "ambiguous"
          ? `Ambiguous resource name: ${resourceSelector}`
          : `Resource not found: ${resourceSelector}`,
      );
      if (resourceResult.status === "ambiguous") {
        for (const match of resourceResult.matches) {
          ui.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
        }
      }
      return;
    }
    addResourceToPreset(preset.id, resourceResult.resource.id);
    ui.success(
      `Added ${resourceResult.resource.type} ${ui.theme.accent(`"${resourceResult.resource.name}"`)} to preset ${ui.theme.accent(preset.name)}`,
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
      ui.danger(`Preset not found: ${presetName}`);
      return;
    }
    const resourceResult = resolveResource(resourceSelector);
    if (resourceResult.status !== "found") {
      ui.danger(
        resourceResult.status === "ambiguous"
          ? `Ambiguous resource name: ${resourceSelector}`
          : `Resource not found: ${resourceSelector}`,
      );
      if (resourceResult.status === "ambiguous") {
        for (const match of resourceResult.matches) {
          ui.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
        }
      }
      return;
    }
    removeResourceFromPreset(preset.id, resourceResult.resource.id);
    ui.success(
      `Removed ${resourceResult.resource.type} ${ui.theme.accent(`"${resourceResult.resource.name}"`)} from preset ${ui.theme.accent(preset.name)}`,
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
        ui.danger(`Preset not found: ${presetName}`);
        return;
      }
      try {
        parseVersionConstraint(opts.version);
      } catch (err) {
        ui.danger(err instanceof Error ? err.message : String(err));
        return;
      }
      addPluginToPreset(preset.id, ref, opts.version);
      syncClaudePresetPluginsAfterAdd(preset, ref, opts.version);
      ui.success(
        `Pinned ${ui.theme.accent(ref)} (${opts.version}) on preset ${ui.theme.accent(preset.name)}`,
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
      ui.danger(`Preset not found: ${presetName}`);
      return;
    }
    removePluginFromPreset(preset.id, ref);
    syncClaudePresetPluginsAfterRemove(preset, ref);
    ui.success(`Removed plugin pin ${ui.theme.accent(ref)} from preset ${ui.theme.accent(preset.name)}`);
  });

presetCmd
  .command("delete")
  .argument("<name>", "Preset name or ID")
  .action((name: string) => {
    const db = getDb();
    initializeSchema(db);
    if (deletePreset(name)) {
      ui.success(`Deleted preset ${ui.theme.accent(name)}`);
    } else {
      ui.danger(`Preset not found: ${name}`);
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
      ui.danger(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    const resources = listResources({ type, search: opts.search });
    if (format === "json") {
      printJson(resources);
      return;
    }
    ui.table.print({
      columns: [
        { key: "type", header: "TYPE", width: 14 },
        { key: "name", header: "NAME", width: 28 },
        { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
        { key: "updated_at", header: "UPDATED", width: 16, transform: (value) => ui.format.formatRelativeTime(String(value)) },
      ],
      rows: resources,
      summary: resources.length === 0 ? undefined : `${resources.length} resources`,
      empty: `No resources found.\n  → Run \`${formatCommand("project scan")}\` to import some.`,
    });
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
      ui.danger(`Resource not found: ${resource}`);
      return;
    }
    if (result.status === "ambiguous") {
      ui.danger(`Ambiguous resource selector: ${resource}`);
      ui.table.print({
        columns: [
          { key: "type", header: "TYPE", width: 14 },
          { key: "name", header: "NAME", width: 26 },
          { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
        ],
        rows: result.matches,
      });
      process.exitCode = 1;
      return;
    }
    const r = result.resource;
    ui.panel({
      title: ["RESOURCE", r.name],
      rows: [
        ["Type", r.type],
        ["Name", r.name],
        ["Description", r.description || "—"],
        ["Source", r.source],
        ["ID", r.id],
        ["Created", r.created_at],
        ["Metadata", JSON.stringify(r.metadata)],
      ],
    });
    ui.subheader("CONTENT");
    console.log(r.content);
  });

resourceCmd
  .command("delete")
  .argument("<resource>", "Resource name or ID")
  .action((resource: string) => {
    const db = getDb();
    initializeSchema(db);
    const result = resolveResource(resource);
    if (result.status === "not_found") {
      ui.danger(`Resource not found: ${resource}`);
      return;
    }
    if (result.status === "ambiguous") {
      ui.danger(`Ambiguous resource name: ${resource}`);
      for (const match of result.matches) {
        ui.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
      }
      return;
    }
    if (deleteResource(result.resource.id)) {
      ui.success(`Deleted ${result.resource.type} ${ui.theme.accent(`"${result.resource.name}"`)}`);
    } else {
      ui.danger(`Resource not found: ${resource}`);
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
    warnDeprecatedCommand(formatCommand("scan"), formatCommand("project scan"));
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
      warnDeprecatedCommand(formatCommand("apply"), formatCommand("project apply"));
      await handleApplyCommand([presetName], opts);
    },
  );

program
  .command("history", { hidden: true })
  .option("--project <path>", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { project: string; format?: string }) => {
    warnDeprecatedCommand(formatCommand("history"), formatCommand("project history"));
    handleHistoryCommand(opts);
  });

program
  .command("revert", { hidden: true })
  .argument("[snapshot-id]", "Snapshot ID to revert to")
  .action((snapshotId?: string) => {
    warnDeprecatedCommand(formatCommand("revert"), formatCommand("project revert"));
    handleRevertCommand(snapshotId);
  });

program
  .command("status", { hidden: true })
  .argument("[path]", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (path: string, opts: { format?: string }) => {
    warnDeprecatedCommand(formatCommand("status"), formatCommand("project status"));
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
    warnDeprecatedCommand(formatCommand("export"), formatCommand("preset export"));
    handlePresetExportCommand(presetName, opts);
  });

program
  .command("import", { hidden: true })
  .argument("<file>", "JSON bundle file to import")
  .action((file: string) => {
    warnDeprecatedCommand(formatCommand("import"), formatCommand("preset import"));
    handlePresetImportCommand(file);
  });

program
  .command("platforms", { hidden: true })
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    warnDeprecatedCommand(formatCommand("platforms"), formatCommand("platform list"));
    handlePlatformListCommand(opts);
  });


// ── cleanup ─────────────────────────────────────────────────────────────

process.on("exit", () => closeDb());

await program.parseAsync();
