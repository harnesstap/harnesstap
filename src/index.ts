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
  detectHomePlatforms,
  isPluginSourcePath,
  scanAndPersistPluginSource,
  scanAndPersistHomeDefaults,
  persistClaudePluginInventoryForProject,
} from "./services/scanner.js";
import {
  applyImportedSnapshotToGlobal,
  generateFiles,
  materializeFiles,
  writeFiles,
} from "./services/applier.js";
import { exportToFile, importFromFile, exportPreset } from "./services/exporter.js";
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
  getPresetResources,
  listPresetDependencies,
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
import {
  getAllPlatforms,
} from "./platforms/registry.js";
import { getDedicatedSerializerPlatformIds } from "./services/platform-serializers.js";
import { seedBuiltInPresets } from "./services/seed-presets.js";
import { basename, resolve } from "node:path";
import { resolveHomeRoot } from "./utils/home-root.js";
import type {
  ImportedSnapshot,
  Preset,
  Resource,
  ResourceType,
  SnapshotState,
} from "./types.js";
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
  getProjectPluginState,
  listPresetPlugins,
  upsertProjectPluginState,
} from "./models/plugin.js";
import type { PluginScope } from "./plugins/types.js";
import {
  getHarnessPreference,
  setHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "./models/harness.js";
import { listImportedSnapshots } from "./models/imported-snapshot.js";
import { resolveHarnessSelection } from "./services/harness-config.js";
import { parseOutputFormat, printJson } from "./utils/output-format.js";
import { getCloudProfile, saveCloudProfile, setDefaultCloudProfile, updateCloudProfile, removeCloudProfile } from "./config/cloud-profiles.js";
import { requestDeviceCode, pollDeviceToken, createCloudClient } from "./services/cloud-client.js";
import { validatePluginPinsAgainstInventory } from "./services/plugin-apply-validation.js";
import { detectProjectDriftFromLatest } from "./services/project-drift.js";
import { diffPresets } from "./services/preset-diff.js";
import { listPresetDoctorChecks, runPresetDoctor } from "./services/preset-doctor.js";
import { mergePresets } from "./services/preset-merge.js";
import { createPresetFromProject } from "./services/preset-from-project.js";
import { isPresetUrl, fetchPresetBundleToTempFile, isBundleFilePath, writePresetBundleToTempFile } from "./services/preset-source.js";
import { syncProject } from "./services/project-sync.js";
import { scanPluginSource } from "./services/plugin-source-import.js";
import {
  addPresetAttachment,
  PRESET_ATTACHMENT_TYPES,
  removePresetAttachment,
} from "./services/preset-attachments.js";
import {
  exportMigrationState,
  importMigrationState,
} from "./services/migrate.js";
import { createProgress } from "./ui/progress.js";
import { promptForChoice, promptForSearchableChoice, promptForValue, shouldUseWizard } from "./services/wizards/shared.js";
import { runPresetAddWizard } from "./services/wizards/preset-add.js";
import { runPresetDeleteWizard } from "./services/wizards/preset-delete.js";
import { runPresetFromProjectWizard } from "./services/wizards/preset-from-project.js";
import { runProjectApplyWizard } from "./services/wizards/project-apply.js";
import { runResourceDeleteWizard } from "./services/wizards/resource-delete.js";
import type { PersistedPluginSourceResults } from "./services/scanner.js";
import type { Column } from "./ui/table.js";

const program = new Command();

function resolveInvocationName(): "harnessdeck" | "hd" {
  return basename(process.argv[1] ?? "") === "hd" ? "hd" : "harnessdeck";
}

function formatCommand(path: string): string {
  return `${resolveInvocationName()} ${path}`.trim();
}

function isVerboseMode(argv: string[] = process.argv): boolean {
  return argv.includes("-v") || argv.includes("--verbose");
}

function renderCliError(error: unknown, argv: string[] = process.argv): void {
  if (isVerboseMode(argv)) {
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
      return;
    }
    console.error(String(error));
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  ui.danger(message);
  
  // Append contextual help for Commander-style errors
  const contextCommand = findContextCommand(argv);
  if (contextCommand) {
    console.error(`\n${contextCommand.helpInformation()}`);
  }
}

function findContextCommand(argv: string[]): Command | null {
  // Skip node path and script path
  const args = argv.slice(2);
  
  // Try to find the deepest matching command
  let currentCommand: Command = program;
  
  for (const arg of args) {
    // Skip flags
    if (arg.startsWith("-")) {
      continue;
    }
    
    // Try to find a subcommand matching this arg
    const subCommand = currentCommand.commands.find(
      (cmd) => cmd.name() === arg || cmd.aliases().includes(arg)
    );
    
    if (subCommand) {
      currentCommand = subCommand;
    } else {
      // No matching subcommand, use current level
      break;
    }
  }
  
  // Only return if we found a subcommand (not the root program)
  return currentCommand !== program ? currentCommand : null;
}

async function resolvePresetMutationTarget(input: {
  presetName?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  message: string;
}): Promise<string | undefined> {
  if (input.presetName) {
    return input.presetName;
  }

  const shouldPrompt = shouldUseWizard({
    interactive: input.interactive,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });

  if (!shouldPrompt) {
    return undefined;
  }

  const presets = listPresets();
  if (presets.length === 0) {
    return undefined;
  }

  return promptForChoice({
    message: input.message,
    choices: presets.map((preset) => ({
      name: formatPresetLabel(preset),
      value: formatPresetLabel(preset),
    })),
  });
}

program.exitOverride();
program.hook("preAction", () => {
  process.exitCode = 0;
});

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

function formatPresetLabel(preset: Pick<Preset, "name" | "version">): string {
  return `${preset.name}@${preset.version}`;
}

function makeIdColumn(showId: boolean, width = 12): Column[] {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => ui.format.shortenId(String(value)),
      }]
    : [];
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

function renderGroupedCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((c) => {
    const hidden = (c as { _hidden?: boolean })._hidden;
    return !hidden;
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
    
    let fullStr = name;
    if (aliases.length) {
      fullStr += ` (${aliases.join(", ")})`;
    }
    if (args) {
      fullStr += ` ${args}`;
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
    lines.push(`  ${ui.theme.command(nameStr)}${padding}${desc}`);
  }

  return lines.join("\n");
}

function configureCommandGroup(cmd: Command): Command {
  cmd.helpCommand(false);
  cmd.action(() => {
    cmd.outputHelp();
  });
  return cmd;
}

function isGroupedCommandFallbackError(error: unknown): error is {
  code: string;
  exitCode: number;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    exitCode?: unknown;
    message?: unknown;
  };

  return candidate.code === "commander.excessArguments"
    && candidate.exitCode === 1
    && typeof candidate.message === "string"
    && /too many arguments for '(preset|resource|project|plugin|cloud|migrate|harness)'/i.test(candidate.message);
}

const NATIVE_HARNESS_IDS = new Set(getDedicatedSerializerPlatformIds());

program
  .name("harnessdeck")
  .description(
    "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
  )
  .version("0.1.0", "-V, --harnessdeck-version")
  .option("-v, --verbose", "Show verbose error output")
  .option("--no-color", "Disable color output")
  .option("--no-interactive", "Disable interactive prompts")
  .helpCommand(false)
  .configureOutput({
    outputError: () => {},
  })
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
      
      const isTopLevel = cmd.parent === null;
      
      if (!isTopLevel) {
        const lines = [
          "",
          ui.theme.heading("USAGE"),
          `  ${cmd.name()} ${cmd.usage()}`,
          "",
        ];
        
        if (cmd.description()) {
          lines.push(cmd.description(), "");
        }
        
        const opts = cmd.options.filter((opt) => !opt.hidden);
        if (opts.length > 0) {
          lines.push(ui.theme.heading("OPTIONS"));
          for (const opt of opts) {
            const flags = opt.flags;
            const desc = opt.description || "";
            lines.push(`  ${ui.theme.flag(flags)}  ${desc}`);
          }
          lines.push("");
        }
        
        const subcommands = renderGroupedCommandHelp(cmd);
        if (subcommands) {
          lines.push(ui.theme.heading("COMMANDS"));
          lines.push(subcommands);
          lines.push("");
        }
        
        return lines.join("\n");
      }
      
      const lines = [
        "",
        ui.theme.primary(resolveInvocationName()),
        "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
        "",
        ui.theme.heading("USAGE"),
        `  ${resolveInvocationName()} [options] [command]`,
        "",
        ui.theme.heading("OPTIONS"),
        `  ${ui.theme.flag("-V, --harnessdeck-version")}  output the version number`,
        `  ${ui.theme.flag("-v, --verbose")}              show verbose error output`,
        `  ${ui.theme.flag("--no-color")}               disable color output`,
        `  ${ui.theme.flag("--no-interactive")}         disable interactive prompts`,
        `  ${ui.theme.flag("-h, --help")}               display help for command`,
        "",
        ui.theme.heading("COMMANDS"),
        renderGroupedCommandHelp(cmd),
        "",
      ];
      
      return lines.join("\n");
    },
  });

async function handleScanCommand(
  path: string,
  opts: { platform?: string; dryRun?: boolean; global?: boolean; harness?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);
  const detected = detectPlatforms(projectRoot);
  const pluginSourcePath = detected.length === 0 && isPluginSourcePath(projectRoot);

  if (opts.harness && !opts.global) {
    throw new Error("--harness can only be used together with --global");
  }

  if (pluginSourcePath) {
    if (opts.platform) {
      throw new Error("--platform is not supported when scanning a plugin source");
    }

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
      homeRoot: resolveHomeRoot(),
      platformIds: parsePlatformFilter(opts.platform),
    });
    if (pluginSummary.installs.length > 0) {
      const check = await checkPlugins({
        projectRoot,
        homeRoot: resolveHomeRoot(),
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
      homeRoot: resolveHomeRoot(),
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
  function importedBundleToApplyResult(imported: ReturnType<typeof importFromFile>) {
    const presets = imported.presets.map((entry) => entry.preset);
    const primaryPreset = presets[presets.length - 1];
    if (!primaryPreset) {
      throw new Error("Bundle contains no presets.");
    }
    const merged = mergePresets(presets.map((preset) => preset.id));
    return {
      presets,
      resources: merged.resources,
      claude: merged.claude,
      primaryPresetId: primaryPreset.id,
    };
  }

  if (presetNames.length === 1 && isPresetUrl(presetNames[0])) {
    const tempFile = await fetchPresetBundleToTempFile(presetNames[0]);
    return importedBundleToApplyResult(
      importFromFile(tempFile, {
        embeddedTargetDir: projectRoot,
      }),
    );
  }

  if (presetNames.length === 1 && isBundleFilePath(presetNames[0])) {
    return importedBundleToApplyResult(
      importFromFile(presetNames[0], {
        embeddedTargetDir: projectRoot,
      }),
    );
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
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

   const resolvedPresetNames = presetNames.length > 0
    ? presetNames
    : await (shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
        ? runProjectApplyWizard().then((presetName) => [presetName] as [string])
        : Promise.resolve([] as []));

  if (resolvedPresetNames.length === 0) {
    process.exitCode = 1;
    ui.danger("Provide at least one preset name, bundle path, or URL.");
    return;
  }

  if (opts.strictPluginVersions && opts.ignorePluginVersions) {
    process.exitCode = 1;
    ui.danger(
      "Choose either --strict-plugin-versions or --ignore-plugin-versions, not both.",
    );
    return;
  }

  const projectRoot = resolve(opts.project);
  let applyBundle: Awaited<ReturnType<typeof resolveApplyPresets>>;
  try {
    applyBundle = await resolveApplyPresets(
      resolvedPresetNames as [string, ...string[]],
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
  const mergedPluginPins = (() => {
    const pins = new Map<string, { ref: string; version_constraint: string }>();
    for (const preset of applyBundle.presets) {
      if (!preset) continue;
      for (const plugin of listPresetPlugins(preset.id)) {
        pins.set(plugin.ref, {
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        });
      }
    }
    return [...pins.values()];
  })();
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
    mergedPluginPins.length > 0
  ) {
    const inventory = await refreshClaudePluginInventoryForCli(projectRoot);
    const issues = validatePluginPinsAgainstInventory(mergedPluginPins, inventory);
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
        resolvedPresetNames.length > 1
          ? `Before applying: ${resolvedPresetNames.join(" + ")}`
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
        presets: resolvedPresetNames,
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
    mergedPluginPins.length > 0
  ) {
    const inventory = await refreshClaudePluginInventoryForCli(projectRoot);
    const issues = validatePluginPinsAgainstInventory(mergedPluginPins, inventory);
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
    process.exitCode = 1;
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
    process.exitCode = 1;
    ui.danger(
      `Please provide a snapshot ID. Use \`${formatCommand("project history")}\` to list them.`,
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

function handlePresetExportCommand(
  presetSelector: string,
  opts: { file?: string; embedPlugins?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const presetNames = presetSelector
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (presetNames.length === 0) {
    ui.danger("Provide at least one preset name or ID to export.");
    return;
  }
  const [firstPresetName] = presetNames;
  if (!firstPresetName) {
    ui.danger("Provide at least one preset name or ID to export.");
    return;
  }
  const filePath = opts.file ?? `${firstPresetName}.harnessdeck.jsonc`;
  const exportSelector = presetNames.length === 1 ? firstPresetName : presetNames;
  exportToFile(exportSelector, filePath, {
    embedPlugins: opts.embedPlugins,
  });
  ui.success(
    `Exported preset ${ui.theme.accent(presetNames.join(", "))} ${ui.icons.hint} ${filePath}`,
  );
}

function handlePresetImportCommand(file: string): void {
  const db = getDb();
  initializeSchema(db);
  const { preset, resources } = importFromFile(file);
  ui.success(
    `Imported preset ${ui.theme.accent(preset.name)} ${ui.icons.bullet} ${formatCount(resources.length, "resource")}`,
  );
}

async function resolveCloudClientForPresetCommand(profileName?: string) {
  const profileInfo = await getCloudProfile(profileName);
  const { profile } = profileInfo;
  if (!profile || !profile.cloudBaseUrl) return undefined;
  const token = profile.accessToken ? {
    access_token: profile.accessToken,
    refresh_token: profile.refreshToken,
    expires_at: typeof profile.accessTokenExpiresAt === 'string' ? Number(profile.accessTokenExpiresAt) : (profile.accessTokenExpiresAt as number | undefined),
  } : undefined;
  return createCloudClient({ baseUrl: profile.cloudBaseUrl, token });
}

function normalizeRemoteLibrarySelector(
  selector: string,
  opts: { org?: string; version?: string },
): { org_slug: string; library_slug: string; version?: string } {
  // Try to parse as full selector first
  const fullMatch = selector.match(/^([^/@]+)\/([^@]+)(?:@(.+))?$/);
  if (fullMatch) {
    const selectorOrg = String(fullMatch[1]);
    const library = String(fullMatch[2]);
    const selectorVersion = fullMatch[3] !== undefined ? String(fullMatch[3]) : undefined;

    // Check for conflicts
    if (opts.org && selectorOrg) {
      throw new Error(`--org conflicts with org in selector. Remove --org or use selector without org.`);
    }
    if (opts.version && selectorVersion) {
      throw new Error(`--version conflicts with version in selector. Remove --version or use selector without version.`);
    }

    return {
      org_slug: selectorOrg,
      library_slug: library,
      version: opts.version ?? selectorVersion,
    };
  }

  // Selector is library-only or library@version
  const libraryMatch = selector.match(/^([^@]+)(?:@(.+))?$/);
  if (!libraryMatch) {
    throw new Error(`Invalid library selector: ${selector}. Use org/library[@version] or library[@version] with --org`);
  }

  const library = String(libraryMatch[1]);
  const selectorVersion = libraryMatch[2] !== undefined ? String(libraryMatch[2]) : undefined;

  if (!opts.org) {
    throw new Error(`org is required. Provide it in the selector as org/library or use --org <slug>`);
  }

  if (opts.version && selectorVersion) {
    throw new Error(`--version conflicts with version in selector. Remove --version or use selector without version.`);
  }

  return {
    org_slug: opts.org,
    library_slug: library,
    version: opts.version ?? selectorVersion,
  };
}

async function handlePresetSearchCommand(query: string, opts: { profile?: string; format?: string }) {
  const format = parseOutputFormat(opts.format);
  try {
    const client = await resolveCloudClientForPresetCommand(opts.profile);
    if (!client) {
      if (format === "json") printJson([]);
      else ui.dim("No cloud profile configured.");
      return;
    }

    const results = await client.searchLibraries(query);
    if (format === "json") {
      printJson(results);
      return;
    }

    if (!results || results.length === 0) {
      ui.dim("No remote results.");
      return;
    }
    for (const r of results) {
      ui.info(`${r.org_slug}/${r.library_slug} — ${r.name ?? r.id}`);
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handlePresetInstallCommand(
  selector: string | undefined,
  opts: { as?: string; org?: string; version?: string; profile?: string; format?: string; interactive?: boolean; noInteractive?: boolean }
) {
  const db = getDb();
  initializeSchema(db);

  // If selector is missing, check if we can prompt for it
  if (!selector) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    });

    if (!canPrompt) {
      process.exitCode = 1;
      ui.danger("error: selector is required in non-interactive mode. Use: preset add org/library[@version]");
      return;
    }

    // Launch interactive search
    try {
      const client = await resolveCloudClientForPresetCommand(opts.profile);
      if (!client) {
        process.exitCode = 1;
        ui.danger("No cloud profile configured. Use `cloud login` to create one or pass --profile.");
        return;
      }

      // Search for all presets to show in picker
      const results = await client.searchLibraries("");
      if (!results || results.length === 0) {
        process.exitCode = 1;
        ui.danger("No remote presets found.");
        return;
      }

      const choices = results.map((r: Record<string, unknown>) => ({
        name: `${r.org_slug}/${r.library_slug} — ${r.name ?? r.id}`,
        value: `${r.org_slug}/${r.library_slug}`,
      }));

      const selected = await promptForSearchableChoice({
        message: "Select a preset to install",
        choices,
      });

      selector = selected;
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  let parsed: { org_slug: string; library_slug: string; version?: string };
  try {
    parsed = normalizeRemoteLibrarySelector(selector, { org: opts.org, version: opts.version });
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }
  const localName = opts.as ?? parsed.library_slug;
  const existing = getPreset(localName);
  if (existing && !opts.as) {
    process.exitCode = 1;
    ui.danger(`Preset name already exists: ${localName}. Use --as to install under a different name.`);
    return;
  }

  // Download the bundle via cloud client
  try {
    const client = await resolveCloudClientForPresetCommand(opts.profile);
    if (!client) {
      process.exitCode = 1;
      ui.danger("No cloud profile configured. Use `cloud login` to create one or pass --profile.");
      return;
    }
    const id = `${parsed.org_slug}/${parsed.library_slug}`;
    const downloaded = await client.downloadLibraryBundle(id, parsed.version);
    const tempPath = writePresetBundleToTempFile(downloaded.body);
    const imported = importFromFile(tempPath, { presetNameOverride: opts.as });
    if (parseOutputFormat(opts.format) === "json") {
      printJson({ preset_name: imported.preset.name, org_slug: parsed.org_slug, library_slug: parsed.library_slug, version: downloaded.version });
      return;
    }
    ui.success(`Installed preset ${imported.preset.name} from ${parsed.org_slug}/${parsed.library_slug}`);
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handlePresetPublishCommand(presetName: string, opts: { org?: string; profile?: string; format?: string }) {
  const db = getDb();
  initializeSchema(db);
  const preset = getPreset(presetName);
  if (!preset) {
    process.exitCode = 1;
    ui.danger(`Preset not found: ${presetName}`);
    return;
  }

  try {
    const client = await resolveCloudClientForPresetCommand(opts.profile);
    if (!client) {
      process.exitCode = 1;
      ui.danger("No cloud profile configured. Use `cloud login` to create one or pass --profile.");
      return;
    }

    // Resolve org slug
    let orgSlug = opts.org;
    if (!orgSlug) {
      const orgs = await client.listOrgs();
      if (orgs.length === 0) {
        process.exitCode = 1;
        ui.danger("No organizations found. You must belong to at least one organization to publish presets.");
        return;
      } else if (orgs.length === 1) {
        // Auto-select the only org
        const [firstOrg] = orgs;
        if (!firstOrg) {
          ui.danger("No organizations found.");
          return;
        }
        orgSlug = String(firstOrg.slug);
        if (parseOutputFormat(opts.format) === "human") {
          ui.info(`Auto-selected organization: ${orgSlug}`);
        }
      } else {
        // Multiple orgs - prompt user
        const canPrompt = shouldUseWizard({
          interactive: true,
          noInteractive: false,
          format: parseOutputFormat(opts.format),
          missingRequiredArgs: true,
        });

        if (!canPrompt) {
          process.exitCode = 1;
          ui.danger("Multiple organizations found. Use --org to specify which organization to publish under.");
          return;
        }

        const choices = orgs.map((org) => ({
          name: String(org.name ?? org.slug),
          value: String(org.slug),
        }));

        orgSlug = await promptForChoice({
          message: "Select organization to publish under",
          choices,
        });
      }
    }

    if (!orgSlug) {
      process.exitCode = 1;
      ui.danger("Failed to determine organization. Use --org to specify.");
      return;
    }

    // build bundle using exporter
    const bundle = exportPreset(preset.id);
    const bundleJson = JSON.stringify(bundle);

    const resp = await client.publishPresetBundle({ preset_name: preset.name, org_slug: orgSlug }, bundleJson);
    if (parseOutputFormat(opts.format) === "json") {
      printJson(resp);
      return;
    }
    ui.success(`Published preset ${preset.name} to ${orgSlug}`);
  } catch (err) {
    process.exitCode = 1;
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Enhance error message for common cases
    if (errorMsg.includes("409")) {
      ui.danger(`Library slug "${preset.name}" already exists in organization. Choose a different preset name or delete the existing library.`);
    } else {
      ui.danger(errorMsg);
    }
  }
}

function handleHarnessListCommand(
  opts: { format?: string; supported?: boolean } = {},
): void {
  const format = parseOutputFormat(opts.format);
  const platforms = getAllPlatforms().filter(
    (platform) => !opts.supported || NATIVE_HARNESS_IDS.has(platform.id),
  );
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
    summary: `${platforms.length} harnesses`,
    empty: "No harnesses found.",
  });
}

function handlePresetShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
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
  const dependencies = listPresetDependencies(preset.id);

  if (format === "json") {
    printJson({
      id: preset.id,
      name: preset.name,
      version: preset.version,
      description: preset.description,
      tags: preset.tags,
      ...(preset.claude ? { claude: preset.claude } : {}),
      created_at: preset.created_at,
      updated_at: preset.updated_at,
      resources,
      plugins,
      dependencies,
    });
    return;
  }

  ui.panel({
    title: ["PRESET", formatPresetLabel(preset)],
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
      ...makeIdColumn(Boolean(opts.showId)),
      { key: "type", header: "TYPE", width: 14 },
      { key: "name", header: "NAME", width: 26 },
    ],
    rows: resources,
    empty: "No resources in this preset.",
  });

  if (dependencies.length > 0) {
    ui.subheader("DEPENDENCIES");
    ui.table.print({
      columns: [
        { key: "dependency_name", header: "NAME", width: 26 },
        { key: "version_constraint", header: "CONSTRAINT", width: 20 },
      ],
      rows: dependencies,
    });
  }
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

function uniqueHarnessTargets(harnesses: string[]): string[] {
  return [...new Set(harnesses.filter(Boolean))];
}

function assertSupportedHarnessTargets(harnesses: string[]): void {
  const supported = new Set(getAllPlatforms().map((platform) => platform.id));
  const invalid = harnesses.filter((harness) => !supported.has(harness));
  if (invalid.length > 0) {
    throw new Error(`Unsupported harness: ${invalid.join(", ")}`);
  }
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

function resolveScanGlobalHarnessTargets(
  harnessOption?: string,
  homeRoot = resolveHomeRoot(),
): string[] {
  const explicitTargets = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  const detectedTargets = uniqueHarnessTargets(
    detectHomePlatforms(homeRoot).map((result) => result.platformId),
  );
  if (detectedTargets.length > 0) {
    return detectedTargets;
  }

  throw new Error(
    "No global harness targets configured. Run harnessdeck harness set or pass --harness <slugs>.",
  );
}

function pluginLifecycleBase(path: string, opts: { platform?: string }) {
  return {
    projectRoot: resolve(path),
    homeRoot: resolveHomeRoot(),
    platformIds: parsePlatformFilter(opts.platform),
  };
}

async function refreshClaudePluginInventoryForCli(
  path: string,
): Promise<ReturnType<typeof scanClaudePluginInventory>> {
  const db = getDb();
  initializeSchema(db);
  const projectRoot = resolve(path);
  const homeRoot = resolveHomeRoot();
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
  const homeRoot = resolveHomeRoot();
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
    const plugins = await listPlugins({ projectRoot, homeRoot: resolveHomeRoot() });
    if (plugins.installs.length > 0) {
      const check = await checkPlugins({ projectRoot, homeRoot: resolveHomeRoot() });
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
  noInteractive?: boolean;
} = {}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const seeded = seedBuiltInPresets();
  const homeDefaults = await scanAndPersistHomeDefaults();
  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format,
    missingRequiredArgs: !opts.main && !opts.aliases,
  });
  const shouldSelectHarness =
    useWizard ||
    Boolean(opts.main) ||
    Boolean(opts.aliases);
  const currentHarnessPreference = getHarnessPreference();
  let savedHarnessPreference:
    | ReturnType<typeof setHarnessPreference>
    | undefined;

  if (shouldSelectHarness) {
    const selection = await resolveHarnessSelection({
      main: opts.main,
      aliases: parseHarnessAliases(opts.aliases),
      nonInteractive: !useWizard,
      current: currentHarnessPreference,
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

  if (shouldSelectHarness && currentHarnessPreference) {
    const aliasSummary =
      currentHarnessPreference.alias_harnesses.join(", ") || "(none)";
    ui.warn(
      `Existing harness defaults will be overwritten (main: ${currentHarnessPreference.main_harness}, aliases: ${aliasSummary}).`,
    );
    console.log("");
  }

  ui.success("Harnessdeck initialized");
  console.log("");
  ui.kvBlock([
    { key: "Database", value: getDbPath() },
    ...(seeded > 0
      ? [{
          key: "Built-in Presets",
          value: `seeded ${formatCount(seeded, "built-in preset")}`,
        }]
      : []),
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
  noInteractive?: boolean;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    missingRequiredArgs: !opts.main && !opts.aliases,
  });
  const selection = await resolveHarnessSelection({
    main: opts.main,
    aliases: parseHarnessAliases(opts.aliases),
    nonInteractive: !useWizard,
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
  noInteractive?: boolean;
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

  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    missingRequiredArgs: !opts.main && !opts.aliases,
  });

  const selection = await resolveHarnessSelection({
    main: opts.main,
    aliases: parseHarnessAliases(opts.aliases),
    nonInteractive: !useWizard,
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

function handlePresetDoctorCommand(
  name: string | undefined,
  opts: { check?: string[]; format?: string; listChecks?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    if (opts.listChecks) {
      const checks = listPresetDoctorChecks().map((check) => ({
        id: check.id,
        description: check.description,
      }));

      if (format === "json") {
        printJson(checks);
        return;
      }

      ui.table.print({
        columns: [
          { key: "id", header: "CHECK", width: 24 },
          { key: "description", header: "DESCRIPTION", width: 56 },
        ],
        rows: checks,
        summary: `${checks.length} checks`,
      });
      return;
    }

    if (!name) {
      throw new Error("Preset name or ID is required unless --list-checks is used.");
    }

    const report = runPresetDoctor({
      nameOrId: name,
      checkIds: opts.check,
    });

    if (format === "json") {
      printJson(report);
      if (!report.valid) process.exitCode = 1;
      return;
    }

    // Human format: show all checks with pass/fail markers
    const allChecks = listPresetDoctorChecks().filter((check) => 
      opts.check?.length ? opts.check.includes(check.id) : true
    );

    const rows: Array<{ check: string; result: string; message: string }> = [];
    const findingsByCheck = new Map<string, typeof report.results>();
    
    for (const result of report.results) {
      if (!findingsByCheck.has(result.check)) {
        findingsByCheck.set(result.check, []);
      }
      const findings = findingsByCheck.get(result.check);
      if (findings) {
        findings.push(result);
      }
    }

    for (const check of allChecks) {
      const findings = findingsByCheck.get(check.id);
      if (findings && findings.length > 0) {
        // Show each finding as a separate row
        for (const finding of findings) {
          rows.push({
            check: check.id,
            result: finding.severity === "error" ? "✗ error" : "✗ warn",
            message: finding.message,
          });
        }
      } else {
        // No findings - show pass
        rows.push({
          check: check.id,
          result: "✓ pass",
          message: "",
        });
      }
    }

    ui.table.print({
      columns: [
        { key: "check", header: "CHECK", width: 22 },
        { key: "result", header: "RESULT", width: 12 },
        { key: "message", header: "MESSAGE", width: 44 },
      ],
      rows,
      summary: report.valid ? `${report.preset}: valid` : `${report.preset}: invalid`,
    });
    if (!report.valid) {
      process.exitCode = 1;
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handlePresetFromProjectCommand(
  name: string | undefined,
  opts: {
    project: string;
    description?: string;
    platform?: string;
    interactive?: boolean;
    noInteractive?: boolean;
    format?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  try {
    const resolvedName = name ?? await (shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    })
      ? runPresetFromProjectWizard()
      : Promise.resolve(undefined));

    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger("error: missing required argument 'name'");
      return;
    }

    const projectRoot = resolve(opts.project);

    // First, preview what would happen
    const { previewPresetFromProject } = await import("./services/preset-from-project.js");
    const preview = await previewPresetFromProject({
      name: resolvedName,
      projectRoot,
      platform: opts.platform,
    });

    // If preset exists and has conflicts, prompt for resolution
    if (preview.presetExists && (preview.conflicts.length > 0 || preview.newResources.length > 0)) {
      const canPrompt = shouldUseWizard({
        interactive: true, // Conflicts require interactive resolution
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: false,
      });

      if (!canPrompt) {
        process.exitCode = 1;
        const parts = [];
        if (preview.conflicts.length > 0) {
          parts.push(`${preview.conflicts.length} conflicting resource(s)`);
        }
        if (preview.newResources.length > 0) {
          parts.push(`${preview.newResources.length} new resource(s)`);
        }
        ui.danger(`Preset "${resolvedName}" already exists with ${parts.join(" and ")}. Use --interactive to resolve conflicts.`);
        return;
      }

      // Show preview
      ui.info(`\nPreset "${resolvedName}" already exists.`);
      if (preview.conflicts.length > 0) {
        ui.info(`Conflicts: ${preview.conflicts.length} resource(s) would be overwritten`);
      }
      if (preview.newResources.length > 0) {
        ui.info(`New resources: ${preview.newResources.length} would be added`);
      }
      ui.info(`Total imports: ${preview.totalImports}\n`);

      const action = await promptForChoice({
        message: "How do you want to proceed?",
        choices: [
          { name: "Overwrite conflicting resources", value: "overwrite" },
          { name: "Create with a different name", value: "rename" },
          { name: "Cancel", value: "cancel" },
        ],
      });

      if (action === "cancel") {
        ui.info("Operation cancelled.");
        return;
      }

      if (action === "rename") {
        const newName = await promptForValue({
          message: "Enter new preset name",
          default: `${resolvedName}-copy`,
        });

        const result = await createPresetFromProject({
          name: newName,
          description: opts.description,
          projectRoot,
          platform: opts.platform,
        });

        ui.success(
          `Created preset ${ui.theme.accent(result.preset.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }

      if (action === "overwrite") {
        const result = await createPresetFromProject({
          name: resolvedName,
          description: opts.description,
          projectRoot,
          platform: opts.platform,
          conflictStrategy: "overwrite",
        });

        ui.success(
          `Updated preset ${ui.theme.accent(result.preset.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }
    }

    // No conflicts or preset doesn't exist - proceed normally
    const result = await createPresetFromProject({
      name: resolvedName,
      description: opts.description,
      projectRoot,
      platform: opts.platform,
    });

    ui.success(
      `Created preset ${ui.theme.accent(result.preset.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
    );
  } catch (err) {
    process.exitCode = 1;
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

const presetCmd = configureCommandGroup(
  program
    .command("preset")
    .alias("p")
    .description("Manage presets (named bundles of resources that can be applied to a project)"),
);

presetCmd
  .command("create")
  .argument("<name>", "Preset name")
  .option("-d, --description <text>", "Preset description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--version <semver>", "Preset version (semver)", "1.0.0")
  .action(
    (
      name: string,
      opts: { description?: string; tags?: string; version?: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];
      const preset = createPreset({
        name,
        version: opts.version,
        description: opts.description,
        tags,
      });
      ui.success(`Created preset ${ui.theme.accent(formatPresetLabel(preset))}`);
    },
  );

presetCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .action((opts: { format?: string; showId?: boolean }) => {
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
        ...makeIdColumn(Boolean(opts.showId)),
        { key: "name", header: "NAME", width: 26 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 44, transform: (value) => value || "—" },
      ],
      rows: presets,
      summary: `${presets.length} presets ${ui.icons.bullet} run \`${formatCommand("preset show <name>")}\` for details`,
      empty: "No presets found.",
    });
  });

presetCmd
  .command("show")
  .argument("[name]", "Preset name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .description("Show preset details, resources, and plugin pins")
  .action(async (name: string | undefined, opts: { format?: string; showId?: boolean; interactive?: boolean; noInteractive?: boolean }) => {
    const resolvedName = name ?? await resolvePresetMutationTarget({
      presetName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which preset do you want to show?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listPresets().length > 0
          ? "error: missing required argument 'name'"
          : `No presets found. Create one with \`${formatCommand("preset create <name>")}\` first.`,
      );
      return;
    }
    handlePresetShowCommand(resolvedName, opts);
  });

presetCmd
  .command("attach")
  .argument("[preset]", "Preset name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type: ${PRESET_ATTACHMENT_TYPES.join(", ")}`)
  .option("--version <constraint>", "Version constraint for plugin or preset dependency")
  .option("--embed", "Embed plugin files on export (plugin attachments only)")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Attach a resource, plugin, or dependency to a preset")
  .action(async (presetName: string | undefined, selector: string | undefined, opts: { type?: string; version?: string; embed?: boolean; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const presetTarget = await resolvePresetMutationTarget({
        presetName,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which preset do you want to update?",
      });
      if (!presetTarget) {
        process.exitCode = 1;
        ui.danger(
          listPresets().length > 0
            ? "error: missing required argument 'preset'"
            : `No presets found. Create one with \`${formatCommand("preset create <name>")}\` first.`,
        );
        return;
      }

      const preset = getPreset(presetTarget);
      if (!preset) {
        process.exitCode = 1;
        ui.danger(`Preset not found: ${presetTarget}`);
        return;
      }

      const wizardValues = await runPresetAddWizard({
        selector,
        type: opts.type,
        version: opts.version,
        embed: opts.embed,
        presetName: preset.name,
        shouldPrompt: shouldUseWizard({
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format: parseOutputFormat(opts.format),
          missingRequiredArgs: !presetName || !selector || !opts.type,
        }),
      });

      if (!wizardValues.selector) {
        throw new Error(`error: missing required argument 'selector'`);
      }

      ui.success(ui.theme.accent(addPresetAttachment({
        preset,
        selector: wizardValues.selector,
        type: wizardValues.type,
        version: wizardValues.version,
        embed: wizardValues.embed ?? opts.embed,
      })));
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

presetCmd
  .command("detach")
  .argument("[preset]", "Preset name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type: ${PRESET_ATTACHMENT_TYPES.join(", ")}`)
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Remove a resource, plugin, or dependency from a preset")
  .action(async (presetName: string | undefined, selector: string | undefined, opts: { type?: string; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const presetTarget = await resolvePresetMutationTarget({
        presetName,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which preset do you want to update?",
      });
      if (!presetTarget) {
        process.exitCode = 1;
        ui.danger(
          listPresets().length > 0
            ? "error: missing required argument 'preset'"
            : `No presets found. Create one with \`${formatCommand("preset create <name>")}\` first.`,
        );
        return;
      }

      const preset = getPreset(presetTarget);
      if (!preset) {
        process.exitCode = 1;
        ui.danger(`Preset not found: ${presetTarget}`);
        return;
      }

      const wizardValues = await runPresetAddWizard({
        selector,
        type: opts.type,
        presetName: preset.name,
        shouldPrompt: shouldUseWizard({
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format: parseOutputFormat(opts.format),
          missingRequiredArgs: !presetName || !selector || !opts.type,
        }),
      });

      if (!wizardValues.selector) {
        throw new Error(`error: missing required argument 'selector'`);
      }

      const result = removePresetAttachment({
        preset,
        selector: wizardValues.selector,
        type: wizardValues.type,
      });
      if (!result.removed && wizardValues.type === "preset-dependency") {
        process.exitCode = 1;
        ui.danger(result.message);
        return;
      }
      ui.success(ui.theme.accent(result.message));
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

presetCmd
  .command("delete")
  .argument("[name]", "Preset name, name@version selector, or ID")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (name: string | undefined, opts: { interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const resolvedName = name ?? await (shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
        ? runPresetDeleteWizard()
        : Promise.resolve(undefined));

      if (!resolvedName) {
        throw new Error("Preset name is required");
      }

      const preset = getPreset(resolvedName);
      if (!preset) {
        process.exitCode = 1;
        ui.danger(`Preset not found: ${resolvedName}`);
        return;
      }
      if (!deletePreset(preset.id)) {
        throw new Error(`Failed to delete preset ${formatPresetLabel(preset)}`);
      }
      ui.success(`Deleted preset ${ui.theme.accent(formatPresetLabel(preset))}`);
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

presetCmd
  .command("export")
  .argument("<preset>", "Preset name/ID, or comma-separated preset list")
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
  .command("search")
  .argument("<query>", "Search query for presets on the cloud catalog")
  .option("--profile <name>", "Cloud profile to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Search remote preset libraries")
  .action(handlePresetSearchCommand);

presetCmd
  .command("add")
  .argument("[selector]", "Remote library selector: org/library[@version] or library[@version] with --org")
  .option("--as <name>", "Add under a different local preset name")
  .option("--org <slug>", "Organization slug (when selector omits org)")
  .option("--version <constraint>", "Version constraint (when selector omits version)")
  .option("--profile <name>", "Cloud profile to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Add a preset from the remote catalog into the local DB")
  .action(handlePresetInstallCommand);

presetCmd
  .command("publish")
  .argument("<preset>", "Local preset name to publish")
  .option("--org <slug>", "Organization slug to publish under")
  .option("--profile <name>", "Cloud profile to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a local preset to the cloud catalog")
  .action(handlePresetPublishCommand);

presetCmd
  .command("diff")
  .argument("<left>", "Preset name or bundle file")
  .argument("<right>", "Preset name or bundle file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two presets or a preset and a bundle file")
  .action(handlePresetDiffCommand);

presetCmd
  .command("doctor")
  .argument("[name]", "Preset name or ID")
  .option("--check <name>", "Run only the named check", (value, previous: string[] = []) => [...previous, value], [])
  .option("--list-checks", "List available checks")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Run doctor checks against a preset")
  .action(handlePresetDoctorCommand);

presetCmd
  .command("from-project")
  .argument("[name]", "New preset name")
  .option("--project <path>", "Project directory", ".")
  .option("-d, --description <text>", "Preset description")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Scan current folder and create a preset from its resources")
  .action(handlePresetFromProjectCommand);

// ── migrate ─────────────────────────────────────────────────────────────

const migrateCmd = configureCommandGroup(
  program
    .command("migrate")
    .description("Export or import full HarnessDeck state for machine migration"),
);

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

const resourceCmd = configureCommandGroup(
  program
    .command("resource")
    .alias("r")
    .description("Manage resources (individual pieces of AI configuration like agents, skills, or instructions)"),
);

resourceCmd
  .command("list")
  .alias("ls")
  .option("-t, --type <type>", "Filter by resource type")
  .option("-s, --search <query>", "Search by name or description")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .action((opts: { type?: string; search?: string; format?: string; showId?: boolean }) => {
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
        ...makeIdColumn(Boolean(opts.showId)),
        { key: "type", header: "TYPE", width: 14 },
        { key: "name", header: "NAME", width: 28 },
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
  .option("--show-id", "Show IDs in list-oriented human tables")
  .action((resource: string, opts: { format?: string; showId?: boolean }) => {
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
          ...makeIdColumn(Boolean(opts.showId)),
          { key: "type", header: "TYPE", width: 14 },
          { key: "name", header: "NAME", width: 26 },
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
  .argument("[resource]", "Resource name or ID")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (resource: string | undefined, opts: { interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const resolvedResource = resource ?? await (shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    })
      ? runResourceDeleteWizard()
      : Promise.resolve(undefined));

    if (!resolvedResource) {
      process.exitCode = 1;
      ui.danger("Resource name is required");
      return;
    }

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
  });

// ── project ─────────────────────────────────────────────────────────────

const projectCmd = configureCommandGroup(
  program
    .command("project")
    .alias("pj")
    .description("Manage project scanning, apply state, and snapshots"),
);

projectCmd
  .command("scan")
  .argument("[path]", "Project directory or plugin source to scan", ".")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--dry-run", "Show what would be imported without writing to DB")
  .option("--global", "Install imported plugin sources into global harness locations")
  .option(
    "--harness <slugs>",
    "Comma-separated harness slugs to target for --global plugin installs",
  )
  .description(
    "Scan a project directory or plugin source and import configurations into the database",
  )
  .action(handleScanCommand);

projectCmd
  .command("apply")
  .argument(
    "[presets...]",
    "Preset name(s), bundle path, or URL (multiple presets are merged in order)",
  )
  .option("--project <path>", "Project directory", ".")
  .option("--platform <slugs>", "Comma-separated platform slugs")
  .option("--dry-run", "Show what would be written")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
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

// ── harness ─────────────────────────────────────────────────────────────

const harnessCmd = configureCommandGroup(
  program
    .command("harness")
    .alias("h")
    .description("Manage harness preferences for main and alias platforms"),
);

harnessCmd
  .command("list")
  .alias("ls")
  .option("--supported", "Only show natively serialized harnesses")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List supported harnesses")
  .action(handleHarnessListCommand);

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

const harnessProjectCmd = configureCommandGroup(
  harnessCmd
    .command("project")
    .description("Manage harness preferences for a git-backed project"),
);

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

const pluginCmd = configureCommandGroup(
  program
    .command("plugin")
    .description("Plugin inventory and lifecycle"),
);

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

// ── cleanup ─────────────────────────────────────────────────────────────

process.on("exit", () => closeDb());

// ── cloud ───────────────────────────────────────────────────────────────

async function handleCloudLoginCommand(profileName: string | undefined, opts: { baseUrl?: string } = {}): Promise<void> {
  const name = profileName ?? "default";
  const baseUrl = opts.baseUrl ?? "https://harnessdeck.kayrnt.fr";
  try {
    const device = await requestDeviceCode(baseUrl);
    console.log(`Visit: ${device.verification_uri}`);
    console.log(`Code:  ${device.user_code}`);
    const token = await pollDeviceToken(baseUrl, device.device_code, { interval: 0.1, maxPolls: 300 });
    const now = Math.floor(Date.now() / 1000);
    const profile = {
      cloudBaseUrl: baseUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: token.expires_in ? now + token.expires_in : undefined,
      refreshTokenExpiresAt: undefined,
      scopes: [],
    };
    await saveCloudProfile(name, profile);
    await setDefaultCloudProfile(name);
    ui.success(`Saved cloud profile: ${name}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudWhoamiCommand(opts: { profile?: string; format?: string } = {}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { profile } = await getCloudProfile(opts.profile);
  if (!profile || !profile.accessToken) {
    if (format === "json") {
      printJson({});
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: profile.cloudBaseUrl,
      token: {
        access_token: profile.accessToken as string,
        refresh_token: profile.refreshToken as string | undefined,
        expires_at: typeof profile.accessTokenExpiresAt === "number"
          ? (profile.accessTokenExpiresAt as number)
          : undefined,
      },
    });
    const info = await client.whoami();
    if (format === "json") {
      printJson(info);
      return;
    }
    ui.info(JSON.stringify(info));
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudOrgsCommand(opts: { profile?: string; switch?: string; format?: string } = {}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { profileName, profile } = await getCloudProfile(opts.profile);
  if (!profile || !profile.accessToken) {
    if (format === "json") {
      printJson([]);
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: profile.cloudBaseUrl,
      token: {
        access_token: profile.accessToken as string,
        refresh_token: profile.refreshToken as string | undefined,
        expires_at: typeof profile.accessTokenExpiresAt === "number"
          ? (profile.accessTokenExpiresAt as number)
          : undefined,
      },
    });
    const orgs = await client.listOrgs();
    if (opts.switch) {
      const target = (orgs as Record<string, unknown>[]).find((o) => String((o as Record<string, unknown>)['slug']) === opts.switch || String((o as Record<string, unknown>)['id']) === opts.switch);
      if (!target) {
        process.exitCode = 1;
        ui.danger(`Organization not found: ${opts.switch}`);
        return;
      }
      if (profileName) {
      await updateCloudProfile(profileName, { orgId: String((target as Record<string, unknown>)['id']), orgSlug: String((target as Record<string, unknown>)['slug']) });
      }
      ui.success(`Switched to org: ${String((target as Record<string, unknown>)["slug"])}`);
      if (format === "json") {
        printJson(target);
      }
      return;
    }
    if (format === "json") {
      printJson(orgs);
      return;
    }
    for (const o of orgs as Record<string, unknown>[]) {
      ui.info(`${String(o["slug"])} ${String(o["name"])}`);
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudLogoutCommand(opts: { profile?: string } = {}): Promise<void> {
  const { profileName, profile } = await getCloudProfile(opts.profile);
  if (!profileName) {
    ui.warn("No cloud profile configured.");
    return;
  }
  try {
    if (profile?.refreshToken) {
      try {
        const client = createCloudClient({
          baseUrl: profile.cloudBaseUrl,
          token: {
            access_token: profile.accessToken as string || "",
            refresh_token: profile.refreshToken as string,
            expires_at: typeof profile.accessTokenExpiresAt === "number"
              ? (profile.accessTokenExpiresAt as number)
              : undefined,
          },
        });
        await client.revokeRefreshToken();
      } catch (_) {
        // ignore revoke errors
      }
    }
    await removeCloudProfile(profileName);
    ui.success(`Logged out: ${profileName}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

// ── cloud ───────────────────────────────────────────────────────────────

const cloudCmd = configureCommandGroup(
  program
    .command("cloud")
    .alias("c")
    .description("Authenticate with Harness cloud and manage cloud profiles"),
);

cloudCmd
  .command("login [profile]")
  .option("--base-url <url>", "Cloud base URL")
  .description("Log into Harness cloud via device authentication")
  .action(async (profile: string | undefined, opts: { baseUrl?: string }) => {
    await handleCloudLoginCommand(profile, opts);
  });

cloudCmd
  .command("whoami")
  .option("--profile <name>", "Profile name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show information about the authenticated user")
  .action(async (opts: { profile?: string; format?: string }) => {
    await handleCloudWhoamiCommand(opts);
  });

cloudCmd
  .command("orgs")
  .option("--profile <name>", "Profile name")
  .option("--switch <org_slug>", "Switch to the given organization slug")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List organizations and optionally switch")
  .action(async (opts: { profile?: string; switch?: string; format?: string }) => {
    await handleCloudOrgsCommand(opts);
  });

cloudCmd
  .command("logout")
  .option("--profile <name>", "Profile name")
  .description("Log out and remove local cloud profile")
  .action(async (opts: { profile?: string }) => {
    await handleCloudLogoutCommand(opts);
  });

export async function runHarnessdeckCli(
  argv: string[] = process.argv,
): Promise<void> {
  program.name(resolveInvocationName());
  process.exitCode = 0;
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync(argv);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (isGroupedCommandFallbackError(error)) {
      const match = error.message.match(/too many arguments for '([^']+)'\. Expected 0 arguments but got \d+\./i);
      const commandName = match?.[1] ?? "command";
      const commandIndex = argv.findIndex(
        (value, index) => index >= 2 && value === commandName,
      );
      const attemptedSubcommand =
        commandIndex >= 0 ? argv[commandIndex + 1] : undefined;
      error.code = "commander.unknownCommand";
      error.message = attemptedSubcommand
        ? `error: unknown command '${commandName} ${attemptedSubcommand}'`
        : `error: unknown command '${commandName}'`;
      throw error;
    }
    if (
      code === "commander.help" ||
      code === "commander.helpDisplayed" ||
      code === "commander.version"
    ) {
      return;
    }
    throw error;
  }
}

if (import.meta.main) {
  try {
    await runHarnessdeckCli();
  } catch (error) {
    process.exitCode =
      error && typeof error === "object" && "exitCode" in error
        ? Number((error as { exitCode?: unknown }).exitCode) || 1
        : 1;
    renderCliError(error);
  }
}
