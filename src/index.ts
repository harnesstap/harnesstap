import { Command } from "commander";
import { PACKAGE_VERSION } from "./version.js";
import { getDb, closeDb, getDbPath, getHarnessdeckDir } from "./db/connection.js";
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
  applyScanConflicts,
  detectPlatforms,
  detectHomePlatforms,
  isPluginSourcePath,
  scanAndPersistPluginSource,
  scanAndPersistHomeDefaults,
} from "./services/scanner.js";
import { syncLinkedResources } from "./services/resource-sync.js";
import type { ImportConflictPolicy } from "./models/resource.js";
import {
  applyImportedSnapshotToGlobal,
  generateFiles,
  materializeFiles,
  writeFiles,
} from "./services/applier.js";
import { exportToFile, importFromFile, exportLayer } from "./services/exporter.js";
import {
  listResources,
  deleteResource,
  resolveResource,
} from "./models/resource.js";
import {
  createPlugin,
  getPlugin,
  listPlugins as listDesignPlugins,
  deletePlugin,
  getPluginResources,
  listPluginDependencies,
  parsePluginSelector,
} from "./models/plugin-component.js";
import {
  upsertProject,
  getProject,
  getProjectByLocalPath,
  getProjectByOrigin,
  applyConfiguredLayerToProject,
  getProjectConfiguredLayers,
} from "./models/project.js";
import {
  getConfiguredLayer,
  ensureImplicitConfiguredLayer,
  resolveConfiguredLayerSelector,
} from "./models/configured-layer.js";
import { getEnvironment } from "./models/environment.js";
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
} from "./models/snapshot.js";
import {
  getAllPlatforms,
} from "./platforms/registry.js";
import { getDedicatedSerializerPlatformIds } from "./services/platform-serializers.js";
import { seedBuiltInPlugins } from "./services/seed-plugins.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { resolveHomeRoot } from "./utils/home-root.js";
import type {
  ImportedSnapshot,
  Layer,
  PermissionMetadata,
  Resource,
  ResourceType,
  SnapshotState,
} from "./types.js";
import { RESOURCE_TYPES } from "./types.js";
import { listLayerPlugins } from "./models/plugin-pins.js";
import { listAttachedPluginPins } from "./services/composition-resource.js";
import type { PluginResourceMetadata } from "./types.js";
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
import {
  downloadCatalogBundle,
  listLibrariesInScope,
} from "./services/catalog-client.js";
import {
  formatCatalogScopeLabel,
  resolveCatalogScope,
} from "./config/catalog.js";
import {
  handleLayerCatalogConnectLibraryCommand,
  handleLayerCatalogConnectOrgCommand,
  handleLayerCatalogDisconnectLibraryCommand,
  handleLayerCatalogDisconnectOrgCommand,
  handleLayerCatalogListCommand,
  renderLayerSearchResults,
} from "./services/layer-catalog.js";
import { runInteractiveCatalogBrowser } from "./services/wizards/interactive-catalog-browser.js";
import {
  syncPluginPinsForApply,
  type SyncPluginPinsForApplyResult,
} from "./services/plugin-apply-sync.js";
import { validatePluginPinsAgainstInventory } from "./services/plugin-apply-validation.js";
import {
  countPluginMaterialResources,
  expandPluginMaterialResources,
} from "./services/plugin-materialize.js";
import { resolvePluginInstallScope, type InstallPluginPinResult } from "./services/plugin-install.js";
import { resolveClaudeEnabledPluginRef } from "./plugins/claude-plugin-ref.js";
import { detectProjectDriftFromLatest } from "./services/project-drift.js";
import { diffLayers } from "./services/layer-diff.js";
import { listLayerDoctorChecks, runLayerDoctor } from "./services/layer-doctor.js";
import { mergePlugins } from "./services/layer-merge.js";
import { mergeConfiguredLayers } from "./services/configured-layer-merge.js";
import { resolveEnvironmentCascadeForApply } from "./services/environment-cascade.js";
import {
  createEnvironmentCommand,
  deleteEnvironmentCommand,
  environmentActivePayload,
  environmentResolvePayload,
  listEnvironmentsCommand,
  setEnvironmentModelConfigCommand,
  setEnvironmentPermissionCommand,
  setEnvironmentSecretCommand,
  setEnvironmentVarCommand,
  setLayerEnvironmentCommand,
  showEnvironmentCommand,
  unsetEnvironmentModelConfigCommand,
  unsetEnvironmentPermissionCommand,
  unsetEnvironmentSecretCommand,
  unsetEnvironmentVarCommand,
  unsetLayerEnvironmentCommand,
  useEnvironmentForProjectCommand,
  useEnvironmentPayload,
} from "./services/environment-commands.js";
import { captureOrRefreshEnvironment } from "./services/environment-capture.js";
import {
  exportEnvironmentJsonc,
  importEnvironmentJsonc,
} from "./services/environment-import-export.js";
import { createLayerFromProject } from "./services/layer-from-project.js";
import { isLayerUrl, fetchLayerBundleToTempFile, isBundleFilePath, writeLayerBundleToTempFile } from "./services/layer-source.js";
import { syncProject } from "./services/project-sync.js";
import { scanPluginSource } from "./services/plugin-source-import.js";
import {
  addLayerAttachment,
  LAYER_ATTACHMENT_TYPES,
  removeLayerAttachment,
  validateLayerAttachmentType,
} from "./services/layer-attachments.js";
import {
  exportMigrationState,
  importMigrationState,
} from "./services/migrate.js";
import { createProgress, type ProgressHandle } from "./ui/progress.js";
import {
  isPromptCancellationError,
  promptForChoice,
  promptForValue,
  shouldUseWizard,
} from "./services/wizards/shared.js";
import { runLayerAddWizard } from "./services/wizards/layer-add.js";
import { runLayerDeleteWizard } from "./services/wizards/layer-delete.js";
import { runLayerFromProjectWizard } from "./services/wizards/layer-from-project.js";
import { runProjectApplyWizard } from "./services/wizards/project-apply.js";
import { runResourceDeleteWizard } from "./services/wizards/resource-delete.js";
import { printResourceShow } from "./services/resource-show.js";
import { runResourceListWizard } from "./services/wizards/resource-list.js";
import type { PersistedPluginSourceResults } from "./services/scanner.js";
import type { Column } from "./ui/table.js";
import {
  renderFlatResourceListTable,
  renderGroupedResourceListTables,
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "./ui/resource-list-render.js";

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

async function resolveLayerMutationTarget(input: {
  layerName?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  message: string;
}): Promise<string | undefined> {
  if (input.layerName) {
    return input.layerName;
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

  const layers = listDesignPlugins();
  if (layers.length === 0) {
    return undefined;
  }

  return promptForChoice({
    message: input.message,
    choices: layers.map((layer) => ({
      name: formatLayerLabel(layer),
      value: formatLayerLabel(layer),
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

function formatLayerLabel(layer: Pick<Layer, "name" | "version">): string {
  return `${layer.name}@${layer.version}`;
}

function dependencyLayerName(dependencyName: string): string {
  const parsed = parsePluginSelector(dependencyName);
  if (parsed.kind === "id") return dependencyName;
  return parsed.name;
}

function resolveDependencyLayerVersion(
  dependencyName: string,
  versionConstraint: string,
): string {
  const name = dependencyLayerName(dependencyName);
  const resolved = getPlugin(`${name}@${versionConstraint}`);
  return resolved?.version ?? "—";
}

function formatLayerDependencyRows(
  dependencies: Array<{ dependency_name: string; version_constraint: string }>,
): Array<{ name: string; version: string; constraint: string }> {
  return dependencies.map((dep) => ({
    name: dependencyLayerName(dep.dependency_name),
    version: resolveDependencyLayerVersion(dep.dependency_name, dep.version_constraint),
    constraint: dep.version_constraint,
  }));
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

function makeResourceTypeColumn(width = 14): Column {
  return {
    key: "type",
    header: "TYPE",
    width,
    style: (value) => ui.theme.resourceType(value),
  };
}

function resolveResourceListType(
  positionalType?: string,
  flagType?: string,
): ResourceType | undefined | "invalid" | "conflict" {
  if (positionalType && flagType && positionalType !== flagType) {
    return "conflict";
  }
  const type = positionalType ?? flagType;
  if (!type) {
    return undefined;
  }
  if (!RESOURCE_TYPES.includes(type as ResourceType)) {
    return "invalid";
  }
  return type as ResourceType;
}

function shouldUseInteractiveResourceList(input: {
  noInteractive?: boolean;
  format?: string;
  search?: string;
}): boolean {
  if (input.search) {
    return false;
  }

  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

function resourceListRenderOptions(opts: {
  showId?: boolean;
  all?: boolean;
}): { showId: boolean; showAll: boolean } {
  return {
    showId: Boolean(opts.showId),
    showAll: Boolean(opts.all),
  };
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
      const wizardResult = await runResourceListWizard({
        type: resolvedType,
        search: opts.search,
        ...resourceListRenderOptions(opts),
      });
      search = wizardResult?.search ?? opts.search;
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
      `No resources found.\n  → Run \`${formatCommand("project scan")}\` to import some.`,
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
  const commands = cmd.commands;

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
    && /too many arguments for '(layer|resource|project|plugin|cloud|migrate|harness|environment)'/i.test(candidate.message);
}

const NATIVE_HARNESS_IDS = new Set(getDedicatedSerializerPlatformIds());

program
  .name("harnessdeck")
  .description(
    "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
  )
  .version(PACKAGE_VERSION, "-V, --harnessdeck-version")
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
        `${ui.theme.primary(resolveInvocationName())} ${ui.theme.muted(`v${PACKAGE_VERSION}`)}`,
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
    message: "How should HarnessDeck handle these conflicts?",
    choices: [
      { name: "Overwrite library copies", value: "overwrite" as const },
      { name: "Keep existing library copies", value: "skip" as const },
      { name: "Cancel scan", value: "cancel" as const },
    ],
  });
}

async function handleScanCommand(
  path: string,
  opts: {
    platform?: string;
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
  const conflictPolicy = resolveScanConflictPolicy(opts);
  let persisted = persistScanResults(results, {
    conflictPolicy,
    namespace: opts.namespace ?? "",
    originRef: projectRoot,
  });
  spin.stop();

  if (persisted.conflicts.length > 0 && conflictPolicy === "prompt") {
    const resolution = await promptScanConflicts(persisted.conflicts);
    if (resolution === "cancel") {
      throw new Error("Scan cancelled due to resource conflicts.");
    }
    const resolved = applyScanConflicts(persisted.conflicts, resolution);
    persisted = {
      ...persisted,
      resources: [...persisted.resources, ...resolved],
      conflicts: [],
    };
  } else if (persisted.conflicts.length > 0) {
    throw new Error(
      `${persisted.conflicts.length} resource conflict(s). Use --overwrite or --skip-existing.`,
    );
  }

  for (const result of results) {
    const importedCount = persisted.importedCounts.get(result.platformId) ?? 0;
    ui.success(`${result.platformId} ${ui.icons.bullet} ${formatCount(importedCount, "resource")}`);
    for (const resource of result.resources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
    }
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
  ui.success(`Project registered: ${name} (${normalized})`);

}

async function resolveApplyLayers(
  layerNames: [string, ...string[]],
  projectRoot: string,
): Promise<{
  layers: ReturnType<typeof getPlugin>[];
  resources: Resource[];
  claude?: import("./types.js").ClaudeLayerConfig;
  configuredLayerIds: string[];
  primaryConfiguredLayerId: string;
}> {
  function resolveConfiguredLayerIds(
    selectors: string[],
  ): string[] {
    return selectors.map((selector) => {
      const configuredLayer = resolveConfiguredLayerSelector(selector);
      if (!configuredLayer) {
        throw new Error(`Layer not found: ${selector}`);
      }
      return configuredLayer.id;
    });
  }

  function importedBundleToApplyResult(imported: ReturnType<typeof importFromFile>) {
    const layers = imported.layers.map((entry) => entry.layer);
    const primaryLayer = layers[layers.length - 1];
    if (!primaryLayer) {
      throw new Error("Bundle contains no layers.");
    }
    const merged = mergePlugins(layers.map((layer) => layer.id));
    const configuredLayer = ensureImplicitConfiguredLayer(primaryLayer.id);
    return {
      layers: merged.layers,
      resources: merged.resources,
      claude: merged.claude,
      configuredLayerIds: [configuredLayer.id],
      primaryConfiguredLayerId: configuredLayer.id,
    };
  }

  if (layerNames.length === 1 && isLayerUrl(layerNames[0])) {
    const tempFile = await fetchLayerBundleToTempFile(layerNames[0]);
    return importedBundleToApplyResult(
      importFromFile(tempFile, {
        embeddedTargetDir: projectRoot,
      }),
    );
  }

  if (layerNames.length === 1 && isBundleFilePath(layerNames[0])) {
    return importedBundleToApplyResult(
      importFromFile(layerNames[0], {
        embeddedTargetDir: projectRoot,
      }),
    );
  }

  const configuredLayerIds = resolveConfiguredLayerIds(layerNames);
  const merged = mergeConfiguredLayers(configuredLayerIds);
  return {
    layers: merged.layers,
    resources: merged.resources,
    claude: merged.claude,
    configuredLayerIds,
    primaryConfiguredLayerId:
      configuredLayerIds[configuredLayerIds.length - 1] ?? "",
  };
}

function formatPluginInstallLine(install: InstallPluginPinResult): string {
  const icon = install.status === "failed" ? ui.icons.warn : ui.icons.success;
  const statusLabel =
    install.status === "already_installed" ? "already installed" : install.status;
  return `  ${icon} ${install.ref} (${install.platformId}, ${install.scope}) ${ui.icons.bullet} ${statusLabel}`;
}

function printPluginInstallLine(install: InstallPluginPinResult): void {
  console.log(formatPluginInstallLine(install));
  if (install.status === "failed" && install.message) {
    console.log(ui.theme.muted(`    ${install.message}`));
  }
}

function printPluginApplyPostSyncSummary(
  sync: SyncPluginPinsForApplyResult,
  extraMaterializedCount: number,
): void {
  if (sync.syncedResourceCount === 0 && extraMaterializedCount === 0) {
    return;
  }

  if (sync.syncedResourceCount > 0) {
    console.log(
      ui.theme.muted(
        `  ${ui.icons.bullet} synced ${formatCount(sync.syncedResourceCount, "linked resource")}`,
      ),
    );
  }
  if (extraMaterializedCount > 0) {
    console.log(
      ui.theme.muted(
        `  ${ui.icons.bullet} ${formatCount(extraMaterializedCount, "plugin resource")} for harness materialization`,
      ),
    );
  }
}

async function handleApplyCommand(
  layerNames: [string, ...string[]] | [],
  opts: {
    project: string;
    harness?: string;
    platform?: string;
    dryRun?: boolean;
    format?: string;
    ignorePluginVersions?: boolean;
    strictPluginVersions?: boolean;
    syncPlugins?: boolean;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

   const resolvedLayerNames = layerNames.length > 0
    ? layerNames
    : await (shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
        ? runProjectApplyWizard().then((layerName) => [layerName] as [string])
        : Promise.resolve([] as []));

  if (resolvedLayerNames.length === 0) {
    process.exitCode = 1;
    ui.danger("Provide at least one layer name, bundle path, or URL.");
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
  let applyBundle: Awaited<ReturnType<typeof resolveApplyLayers>>;
  const layerLabel = resolvedLayerNames.join(" + ");
  const resolveSpin = createProgress(`Resolving ${layerLabel}…`);
  try {
    applyBundle = await resolveApplyLayers(
      resolvedLayerNames as [string, ...string[]],
      projectRoot,
    );
  } catch (err) {
    resolveSpin.stop();
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }
  resolveSpin.stop();

  const primaryLayer = applyBundle.layers[applyBundle.layers.length - 1];
  if (!primaryLayer) {
    ui.danger("No layer resolved for apply");
    return;
  }

  if (opts.harness && opts.platform) {
    process.exitCode = 1;
    ui.danger("Choose either --harness or --platform, not both.");
    return;
  }

  let platforms: string[];
  try {
    platforms = resolveApplyHarnessTargets(
      projectRoot,
      opts.harness ?? opts.platform,
    );
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  if (platforms.length === 0) {
    ui.warn(
      "No harness targets configured. Run harnessdeck harness set or pass --harness <slugs>.",
    );
    return;
  }

  const { resources, claude } = applyBundle;
  const resolvedEnvironment = resolveEnvironmentCascadeForApply({
    configuredLayerIds: applyBundle.configuredLayerIds,
    projectRoot,
  });
  const mergedPluginPins = (() => {
    const pins = new Map<string, { ref: string; version_constraint: string }>();
    for (const layer of applyBundle.layers) {
      if (!layer) continue;
      for (const plugin of listLayerPlugins(layer.id)) {
        pins.set(plugin.ref, {
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        });
      }
    }
    return [...pins.values()];
  })();

  let pluginSync: SyncPluginPinsForApplyResult | undefined;
  if (!opts.ignorePluginVersions && mergedPluginPins.length > 0 && !opts.dryRun) {
    console.log(ui.theme.muted("Plugins"));
    let pluginProgress: ProgressHandle | null = null;

    pluginSync = await syncPluginPinsForApply({
      pins: mergedPluginPins,
      syncAll: opts.syncPlugins,
      projectRoot,
      scope: resolvePluginInstallScope(projectRoot, Boolean(getGitOrigin(projectRoot))),
      ignoreMissingInstall: opts.ignorePluginVersions,
      progress: {
        onInstallStart: (ref) => {
          pluginProgress?.stop();
          pluginProgress = createProgress(`Installing ${ref}…`);
        },
        onInstallComplete: (install) => {
          pluginProgress?.stop();
          pluginProgress = null;
          printPluginInstallLine(install);
        },
        onSyncStart: (ref) => {
          pluginProgress?.stop();
          pluginProgress = createProgress(`Syncing ${ref}…`);
        },
        onSyncComplete: () => {
          pluginProgress?.stop();
          pluginProgress = null;
        },
      },
    });
    pluginProgress?.stop();

    const extraMaterialized = countPluginMaterialResources(mergedPluginPins, resources);
    printPluginApplyPostSyncSummary(pluginSync, extraMaterialized);

    if (pluginSync.unresolvedPins.length > 0) {
      for (const ref of pluginSync.unresolvedPins) {
        console.warn(
          ui.theme.warn(
            `Plugin ${ref} is not installed locally. Run: harnessdeck resource sync plugin:${ref}`,
          ),
        );
      }
      if (opts.strictPluginVersions) {
        ui.danger("Plugin install failed — apply aborted");
        process.exitCode = 2;
        return;
      }
    }
  }

  const applyResources = expandPluginMaterialResources(mergedPluginPins, resources);

  const homeRoot = resolveHomeRoot();
  const resolvedClaude =
    claude?.plugins && claude.plugins.length > 0
      ? {
          ...claude,
          plugins: claude.plugins.map((plugin) => ({
            ...plugin,
            id: resolveClaudeEnabledPluginRef(plugin.id, homeRoot),
          })),
        }
      : claude;

  const generateSpin = createProgress("Generating harness files…");
  let generated: Awaited<ReturnType<typeof generateFiles>>;
  try {
    generated = await generateFiles(
      applyResources,
      platforms,
      projectRoot,
      { claudeConfig: resolvedClaude, resolvedEnvironment },
    );
  } finally {
    generateSpin.stop();
  }

  // Strict plugin validation must happen BEFORE any files are written.
  if (
    !opts.dryRun &&
    opts.strictPluginVersions &&
    !opts.ignorePluginVersions &&
    mergedPluginPins.length > 0
  ) {
    const issues = validatePluginPinsAgainstInventory(mergedPluginPins);
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
      layers: applyBundle.layers.filter((p): p is NonNullable<typeof p> => p != null),
      resources: applyResources,
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
        resolvedLayerNames.length > 1
          ? `Before applying: ${resolvedLayerNames.join(" + ")}`
          : `Before applying: ${primaryLayer.name}`,
      state: snapshotState,
    });

    applyConfiguredLayerToProject({
      project_id: project.id,
      configured_layer_id: applyBundle.primaryConfiguredLayerId,
      platforms,
    });
  }

  if (opts.dryRun) {
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        layer: primaryLayer.name,
        layers: resolvedLayerNames,
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
    const issues = validatePluginPinsAgainstInventory(mergedPluginPins);
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

function handleLayerExportCommand(
  layerSelector: string,
  opts: { file?: string; embedPlugins?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const layerNames = layerSelector
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (layerNames.length === 0) {
    ui.danger("Provide at least one layer name or ID to export.");
    return;
  }
  const [firstLayerName] = layerNames;
  if (!firstLayerName) {
    ui.danger("Provide at least one layer name or ID to export.");
    return;
  }
  const filePath = opts.file ?? `${firstLayerName}.harnessdeck.jsonc`;
  const exportSelector = layerNames.length === 1 ? firstLayerName : layerNames;
  exportToFile(exportSelector, filePath, {
    embedPlugins: opts.embedPlugins,
  });
  ui.success(
    `Exported layer ${ui.theme.accent(layerNames.join(", "))} ${ui.icons.hint} ${filePath}`,
  );
}

function handleLayerImportCommand(file: string): void {
  const db = getDb();
  initializeSchema(db);
  const { layer, resources } = importFromFile(file);
  ui.success(
    `Imported layer ${ui.theme.accent(layer.name)} ${ui.icons.bullet} ${formatCount(resources.length, "resource")}`,
  );
}

async function resolveCloudClientForLayerCommand(profileName?: string) {
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

async function handleLayerSearchCommand(
  query: string,
  opts: { profile?: string; format?: string; baseUrl?: string },
) {
  const format = parseOutputFormat(opts.format);
  try {
    const results = await listLibrariesInScope(
      { q: query, limit: 25, sort: "updated" },
      { profile: opts.profile, baseUrl: opts.baseUrl },
    );
    if (format === "json") {
      printJson(results);
      return;
    }

    renderLayerSearchResults(results);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleLayerInstallCommand(
  selector: string | undefined,
  opts: {
    as?: string;
    org?: string;
    version?: string;
    profile?: string;
    baseUrl?: string;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
) {
  const db = getDb();
  initializeSchema(db);
  const scope = resolveCatalogScope({ baseUrl: opts.baseUrl });

  if (!selector) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    });

    if (!canPrompt) {
      process.exitCode = 1;
      ui.danger("error: selector is required in non-interactive mode. Use: layer add org/library[@version]");
      return;
    }

    try {
      const selected = await runInteractiveCatalogBrowser({
        message: "Select a layer to install",
        scopeLabel: formatCatalogScopeLabel(scope),
        listLibraries: ({ q, limit }) =>
          listLibrariesInScope(
            { q, limit, sort: "updated" },
            { profile: opts.profile, baseUrl: opts.baseUrl },
          ),
      });
      selector = `${selected.orgSlug}/${selected.slug}`;
      if (!opts.version && selected.version) {
        opts = { ...opts, version: selected.version };
      }
    } catch (err) {
      process.exitCode = 1;
      if (isPromptCancellationError(err)) {
        return;
      }
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
  const existing = getPlugin(localName);
  if (existing && !opts.as) {
    process.exitCode = 1;
    ui.danger(`Layer name already exists: ${localName}. Use --as to install under a different name.`);
    return;
  }

  try {
    const downloaded = await downloadCatalogBundle({
      orgSlug: parsed.org_slug,
      librarySlug: parsed.library_slug,
      version: parsed.version,
      profile: opts.profile,
      baseUrl: opts.baseUrl,
    });
    const tempPath = writeLayerBundleToTempFile(downloaded.body);
    const imported = importFromFile(tempPath, { layerNameOverride: opts.as });
    if (parseOutputFormat(opts.format) === "json") {
      printJson({
        layer_name: imported.layer.name,
        org_slug: parsed.org_slug,
        library_slug: parsed.library_slug,
        version: downloaded.version,
      });
      return;
    }
    ui.success(`Installed layer ${imported.layer.name} from ${parsed.org_slug}/${parsed.library_slug}`);
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleLayerPublishCommand(layerName: string, opts: { org?: string; profile?: string; format?: string }) {
  const db = getDb();
  initializeSchema(db);
  const layer = getPlugin(layerName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerName}`);
    return;
  }

  try {
    const client = await resolveCloudClientForLayerCommand(opts.profile);
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
        ui.danger("No organizations found. You must belong to at least one organization to publish layers.");
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
    const bundle = exportLayer(layer.id);
    const bundleJson = JSON.stringify(bundle);

    const resp = await client.publishLayerBundle({ layer_name: layer.name, org_slug: orgSlug }, bundleJson);
    if (parseOutputFormat(opts.format) === "json") {
      printJson(resp);
      return;
    }
    ui.success(`Published layer ${layer.name} to ${orgSlug}`);
  } catch (err) {
    process.exitCode = 1;
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Enhance error message for common cases
    if (errorMsg.includes("409")) {
      ui.danger(`Library slug "${layer.name}" already exists in organization. Choose a different layer name or delete the existing library.`);
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

function handleLayerShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const layer = getPlugin(name);
  if (!layer) {
    ui.danger(`Layer not found: ${name}`);
    return;
  }
  const allResources = getPluginResources(layer.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin" && resource.type !== "layer",
  );
  const plugins = listLayerPlugins(layer.id);
  const pluginPins = listAttachedPluginPins(layer.id);
  const dependencies = listPluginDependencies(layer.id);
  const configuredLayer = (() => {
    if (/^[0-9A-Z]{26}$/.test(name)) {
      return getConfiguredLayer(name);
    }
    const atIdx = name.lastIndexOf("@");
    if (atIdx > 0) {
      return resolveConfiguredLayerSelector(name);
    }
    return resolveConfiguredLayerSelector(`${layer.name}@${layer.version}`);
  })();
  const configuredLayerDefaultEnvironment = configuredLayer?.default_environment_id
    ? getEnvironment(configuredLayer.default_environment_id)
    : undefined;

  if (format === "json") {
    printJson({
      id: layer.id,
      name: layer.name,
      version: layer.version,
      description: layer.description,
      tags: layer.tags,
      ...(layer.claude ? { claude: layer.claude } : {}),
      created_at: layer.created_at,
      updated_at: layer.updated_at,
      resources,
      plugins,
      dependencies,
      ...(configuredLayer
        ? {
            configured_layer: {
              id: configuredLayer.id,
              name: configuredLayer.name,
              version: configuredLayer.version,
              default_environment: configuredLayerDefaultEnvironment?.name
                ?? configuredLayer.default_environment_id
                ?? null,
            },
          }
        : {}),
    });
    return;
  }

  ui.panel({
    title: ["LAYER", formatLayerLabel(layer)],
    rows: [
      ["Description", layer.description || "—"],
      ["Tags", layer.tags.length > 0 ? layer.tags.join(", ") : "—"],
      ["Resources", `${resources.length} (${summarizeResourceTypes(resources) || "none"})`],
      ["Plugins", plugins.length === 0 ? "(none pinned)" : `${plugins.length}`],
      ...(configuredLayer
        ? [[
            "Default environment",
            configuredLayerDefaultEnvironment?.name
              ?? configuredLayer.default_environment_id
              ?? "—",
          ]] as [string, string][]
        : []),
      ["Updated", ui.format.formatRelativeTimeWithAbsolute(layer.updated_at)],
    ],
  });

  ui.subheader("RESOURCES");
  ui.table.print({
    columns: [
      ...makeIdColumn(Boolean(opts.showId)),
      makeResourceTypeColumn(),
      { key: "name", header: "NAME", width: 26 },
    ],
    rows: resources,
    empty: "No resources in this layer.",
  });

  if (dependencies.length > 0) {
    ui.subheader("LAYER DEPENDENCIES");
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 22 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "constraint", header: "CONSTRAINT", width: 20 },
      ],
      rows: formatLayerDependencyRows(dependencies),
    });
  }
  if (plugins.length > 0) {
    ui.subheader("PLUGINS");
    ui.table.print({
      columns: [
        { key: "ref", header: "REF", width: 28 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "constraint", header: "CONSTRAINT", width: 20 },
        { key: "sync", header: "SYNC", width: 14 },
      ],
      rows: pluginPins.map((pin) => {
        const metadata = pin.resource.metadata as PluginResourceMetadata;
        return {
          ref: pin.ref,
          version: metadata.resolved_version ?? "—",
          constraint: pin.version_constraint || "latest",
          sync: metadata.sync_status ?? "never_synced",
        };
      }),
    });
  }
}

function parsePlatformFilter(platform?: string): string[] | undefined {
  return platform?.split(",").map((p) => p.trim()).filter(Boolean);
}

function parseHarnessAliases(aliases?: string): string[] | undefined {
  return aliases
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseVarAssignment(raw: string): { key: string; value: string } {
  const idx = raw.indexOf("=");
  if (idx <= 0) {
    throw new Error(`Invalid --var entry "${raw}". Expected KEY=VALUE.`);
  }
  return {
    key: raw.slice(0, idx),
    value: raw.slice(idx + 1),
  };
}

function parsePermissionPattern(
  raw: string,
): { action: PermissionMetadata["action"]; pattern: string } {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx >= raw.length - 1) {
    throw new Error(`Invalid permission "${raw}". Expected action:pattern.`);
  }
  const action = raw.slice(0, idx) as PermissionMetadata["action"];
  if (!["allow", "deny", "ask"].includes(action)) {
    throw new Error(`Invalid permission action "${action}". Use allow, deny, or ask.`);
  }
  return {
    action,
    pattern: raw.slice(idx + 1),
  };
}

function parsePermissionUnsetSelector(
  raw: string,
): { action?: PermissionMetadata["action"]; pattern?: string; name?: string } {
  try {
    const parsed = parsePermissionPattern(raw);
    return parsed;
  } catch {
    return { name: raw };
  }
}

function renderEnvironmentShowHuman(payload: ReturnType<typeof showEnvironmentCommand>): void {
  ui.panel({
    title: ["ENVIRONMENT", payload.environment.name],
    rows: [
      ["Description", payload.environment.description || "—"],
      ["Env vars", `${Object.keys(payload.values.env_vars).length}`],
      ["Model configs", `${payload.values.model_configs.length}`],
      ["Permissions", `${payload.values.permissions.length}`],
      ["Secret refs", `${Object.keys(payload.secret_refs).length}`],
    ],
  });

  if (Object.keys(payload.values.env_vars).length > 0) {
    ui.subheader("ENV VARS");
    ui.table.print({
      columns: [
        { key: "key", header: "KEY", width: 28 },
        { key: "value", header: "VALUE", width: 60 },
      ],
      rows: Object.entries(payload.values.env_vars).map(([key, value]) => ({ key, value })),
    });
  }

  if (payload.values.model_configs.length > 0) {
    ui.subheader("MODEL CONFIGS");
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 24 },
        { key: "model", header: "MODEL", width: 28 },
        { key: "provider", header: "PROVIDER", width: 20 },
      ],
      rows: payload.values.model_configs.map((entry) => ({
        ...entry,
        provider: entry.provider ?? "—",
      })),
    });
  }

  if (payload.values.permissions.length > 0) {
    ui.subheader("PERMISSIONS");
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 30 },
        { key: "action", header: "ACTION", width: 10 },
        { key: "pattern", header: "PATTERN", width: 38 },
      ],
      rows: payload.values.permissions,
    });
  }

  if (Object.keys(payload.secret_refs).length > 0) {
    ui.subheader("SECRET REFS");
    ui.table.print({
      columns: [
        { key: "key", header: "KEY", width: 24 },
        { key: "provider", header: "PROVIDER", width: 12 },
        { key: "ref", header: "REF", width: 40 },
      ],
      rows: Object.entries(payload.secret_refs).map(([key, value]) => ({
        key,
        provider: value.provider,
        ref: value.ref,
      })),
    });
  }
}

function writeHomeActiveEnvironment(name: string): string {
  const home = getHarnessdeckDir();
  mkdirSync(home, { recursive: true });
  const filePath = join(home, "active-environment.json");
  writeFileSync(filePath, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8");
  return filePath;
}

function resolveConfiguredLayersForCascade(
  projectRoot: string,
  selectors?: string[],
): string[] {
  if (selectors && selectors.length > 0) {
    return selectors.map((selector) => {
      const configuredLayer = resolveConfiguredLayerSelector(selector);
      if (!configuredLayer) {
        throw new Error(`Configured layer not found: ${selector}`);
      }
      return configuredLayer.id;
    });
  }
  const project = getProjectByLocalPath(projectRoot);
  if (!project) {
    throw new Error(`No tracked project found at ${projectRoot}; pass --layers explicitly`);
  }
  const configuredLayerIds = getProjectConfiguredLayers(project.id).map(
    (row) => row.configured_layer_id,
  );
  if (configuredLayerIds.length === 0) {
    throw new Error(
      `Project ${projectRoot} has no applied configured layers; pass --layers explicitly`,
    );
  }
  return configuredLayerIds;
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

function resolveApplyHarnessTargets(
  projectRoot: string,
  harnessOption?: string,
): string[] {
  const explicitTargets = uniqueHarnessTargets(
    parsePlatformFilter(harnessOption) ?? [],
  );
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const projectByPath = getProjectByLocalPath(projectRoot);
  const projectConfig = projectByPath
    ? getProjectHarnessConfig(projectByPath.id)
    : undefined;
  if (projectConfig) {
    const preferredTargets = uniqueHarnessTargets([
      projectConfig.main_harness,
      ...projectConfig.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
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

  return uniqueHarnessTargets(detectPlatforms(projectRoot));
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
  const projectByPath = getProjectByLocalPath(projectRoot);
  const configuredLayerIds = projectByPath
    ? getProjectConfiguredLayers(projectByPath.id).map((row) => row.configured_layer_id)
    : [];
  const environmentCascade = environmentActivePayload({
    projectRoot,
    configuredLayerIds,
  });

  if (!gitOrigin) {
    if (format === "json") {
      printJson({
        project_root: projectRoot,
        git_origin: null,
        platforms: detected,
        environment_cascade: environmentCascade,
      });
      return;
    }
    ui.panel({
      title: ["PROJECT"],
      rows: [
        ["Root", projectRoot],
        ["Git origin", "(none)"],
        ["Platforms", detected.join(", ") || "(none detected)"],
        ["Environment vars", `${Object.keys(environmentCascade.resolved.vars).length}`],
        ["Environment secrets", `${Object.keys(environmentCascade.resolved.secretRefs).length}`],
        ["Plugin refs", "use `hd resource sync` on library plugin resources"],
      ],
    });
    ui.subheader("ENVIRONMENT CASCADE");
    ui.info(JSON.stringify(environmentCascade, null, 2));
    return;
  }

  const normalizedOrigin = normalizeGitUrl(gitOrigin);
  const project = getProjectByOrigin(normalizedOrigin);
  const layers = project ? getProjectConfiguredLayers(project.id) : [];
  const snapshots = project ? listSnapshots(project.id) : [];

  if (format === "json") {
    const payload: Record<string, unknown> = {
      project_root: projectRoot,
      git_origin: normalizedOrigin,
      platforms: detected,
      environment_cascade: environmentCascade,
    };
    if (project) {
      payload.applied_layers = layers.length;
      payload.snapshots = snapshots.length;
    }
    printJson(payload);
    return;
  }

  const rows: [string, string][] = [
    ["Root", projectRoot],
    ["Git origin", gitOrigin],
    ["Platforms", detected.join(", ") || "(none detected)"],
  ];
  if (project) {
    rows.push(["Applied layers", `${layers.length}`]);
    rows.push(["Snapshots", `${snapshots.length}`]);
  }
  rows.push(["Environment vars", `${Object.keys(environmentCascade.resolved.vars).length}`]);
  rows.push([
    "Environment secrets",
    `${Object.keys(environmentCascade.resolved.secretRefs).length}`,
  ]);
  rows.push(["Plugin refs", "sync library resources with `hd resource sync`"]);

  ui.panel({ title: ["PROJECT"], rows });
  ui.subheader("ENVIRONMENT CASCADE");
  ui.info(JSON.stringify(environmentCascade, null, 2));
}

function printEnvironmentMutationResult(
  payload: ReturnType<typeof showEnvironmentCommand>,
  format: "human" | "json",
): void {
  if (format === "json") {
    printJson(payload);
    return;
  }
  renderEnvironmentShowHuman(payload);
}

async function handleEnvironmentCaptureCommand(
  mode: "capture" | "refresh",
  name: string,
  opts: {
    project: string;
    layers?: string[];
    includePermissions?: boolean;
    dryRun?: boolean;
    strict?: boolean;
    format?: string;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project);
  const result = await captureOrRefreshEnvironment({
    mode,
    environmentName: name,
    projectRoot,
    layerSelectors: opts.layers,
    includePermissions: opts.includePermissions,
    dryRun: opts.dryRun,
    strict: opts.strict,
  });

  if (format === "json") {
    printJson(result);
  } else {
    ui.panel({
      title: ["ENVIRONMENT", `${mode} ${name}`],
      rows: [
        ["Project", projectRoot],
        ["Main harness", result.main_harness],
        ["Configured layers", `${result.configured_layer_ids.length}`],
        ["Persisted", result.persisted ? "yes" : "no"],
        ["Missing keys", `${result.missing_keys.length}`],
      ],
    });
    if (result.missing_keys.length > 0) {
      ui.subheader("MISSING KEYS");
      for (const missing of result.missing_keys) {
        const sources = missing.sources.length > 0 ? missing.sources.join(", ") : "unknown";
        ui.warn(`${missing.key} (${sources})`);
      }
    }
  }

  if (result.strict_failed) {
    process.exitCode = 1;
    if (format === "human") {
      ui.danger("Strict mode failed: missing required environment keys.");
    }
  }
}

async function handleEnvironmentUseCommand(
  name: string,
  opts: { project?: string; reapply?: boolean; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = opts.project ? resolve(opts.project) : undefined;

  if (projectRoot) {
    const payload = useEnvironmentForProjectCommand(name, projectRoot);
    if (format === "json") {
      printJson(payload);
    } else if (payload.deck_tracked) {
      ui.success(
        `Set active environment ${ui.theme.accent(payload.environment_name)} for ${projectRoot}`,
      );
    } else {
      ui.success(
        `Set active environment ${ui.theme.accent(payload.environment_name)} for ${projectRoot} ${ui.icons.bullet} wrote ${payload.deck_file}`,
      );
    }

    if (opts.reapply) {
      const project = getProjectByLocalPath(projectRoot);
      if (!project) {
        ui.warn(`Reapply skipped: no tracked project at ${projectRoot}.`);
        return;
      }
      const configuredLayerIds = getProjectConfiguredLayers(project.id).map(
        (row) => row.configured_layer_id,
      );
      if (configuredLayerIds.length === 0) {
        ui.warn(`Reapply skipped: no configured layers recorded for ${projectRoot}.`);
        return;
      }
      await handleApplyCommand(configuredLayerIds as [string, ...string[]], {
        project: projectRoot,
      });
    }
    return;
  }

  const payload = useEnvironmentPayload(name);
  const filePath = writeHomeActiveEnvironment(payload.environment_name);
  if (format === "json") {
    printJson({ ...payload, written: filePath });
    return;
  }
  ui.success(`Set active home environment ${ui.theme.accent(payload.environment_name)}`);
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
  const seeded = seedBuiltInPlugins();
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
      built_in_layers: {
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
          key: "Built-in Layers",
          value: `seeded ${formatCount(seeded, "built-in layer")}`,
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

function handleLayerDiffCommand(
  left: string,
  right: string,
  opts: { format?: string },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    const report = diffLayers(left, right);
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

function handleLayerDoctorCommand(
  name: string | undefined,
  opts: { check?: string[]; format?: string; listChecks?: boolean },
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  try {
    if (opts.listChecks) {
      const checks = listLayerDoctorChecks().map((check) => ({
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
      throw new Error("Layer name or ID is required unless --list-checks is used.");
    }

    const report = runLayerDoctor({
      nameOrId: name,
      checkIds: opts.check,
    });

    if (format === "json") {
      printJson(report);
      if (!report.valid) process.exitCode = 1;
      return;
    }

    // Human format: show all checks with pass/fail markers
    const allChecks = listLayerDoctorChecks().filter((check) => 
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
      summary: report.valid ? `${report.layer}: valid` : `${report.layer}: invalid`,
    });
    if (!report.valid) {
      process.exitCode = 1;
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handleLayerFromProjectCommand(
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
      ? runLayerFromProjectWizard()
      : Promise.resolve(undefined));

    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger("error: missing required argument 'name'");
      return;
    }

    const projectRoot = resolve(opts.project);

    // First, preview what would happen
    const { previewLayerFromProject } = await import("./services/layer-from-project.js");
    const preview = await previewLayerFromProject({
      name: resolvedName,
      projectRoot,
      platform: opts.platform,
    });

    // If layer exists and has conflicts, prompt for resolution
    if (preview.layerExists && (preview.conflicts.length > 0 || preview.newResources.length > 0)) {
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
        ui.danger(`Layer "${resolvedName}" already exists with ${parts.join(" and ")}. Use --interactive to resolve conflicts.`);
        return;
      }

      // Show preview
      ui.info(`\nLayer "${resolvedName}" already exists.`);
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
          message: "Enter new layer name",
          default: `${resolvedName}-copy`,
        });

        const result = await createLayerFromProject({
          name: newName,
          description: opts.description,
          projectRoot,
          platform: opts.platform,
        });

        ui.success(
          `Created layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }

      if (action === "overwrite") {
        const result = await createLayerFromProject({
          name: resolvedName,
          description: opts.description,
          projectRoot,
          platform: opts.platform,
          conflictStrategy: "overwrite",
        });

        ui.success(
          `Updated layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
        );
        return;
      }
    }

    // No conflicts or layer doesn't exist - proceed normally
    const result = await createLayerFromProject({
      name: resolvedName,
      description: opts.description,
      projectRoot,
      platform: opts.platform,
    });

    ui.success(
      `Created layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
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
    ui.success(`Exported migration archive ${ui.icons.hint} ${file} ${ui.icons.bullet} ${manifest.layer_count} layers`);
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
      `Imported migration archive ${ui.icons.bullet} ${formatCount(result.layers_imported, "layer")}`,
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

// ── layer ──────────────────────────────────────────────────────────────

const layerCmd = configureCommandGroup(
  program
    .command("layer")
    .alias("l")
    .description("Manage layers (named bundles of resources that can be applied to a project)"),
);

layerCmd
  .command("create")
  .argument("<name>", "Layer name")
  .option("-d, --description <text>", "Layer description")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--version <semver>", "Layer version (semver)", "1.0.0")
  .action(
    (
      name: string,
      opts: { description?: string; tags?: string; version?: string },
    ) => {
      const db = getDb();
      initializeSchema(db);
      const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];
      const layer = createPlugin({
        name,
        version: opts.version,
        description: opts.description,
        tags,
      });
      ui.success(`Created layer ${ui.theme.accent(formatLayerLabel(layer))}`);
    },
  );

layerCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .action((opts: { format?: string; showId?: boolean }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const layers = listDesignPlugins();
    if (format === "json") {
      printJson(layers);
      return;
    }
    ui.table.print({
      columns: [
        ...makeIdColumn(Boolean(opts.showId)),
        { key: "name", header: "NAME", width: 26 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 44, transform: (value) => value || "—" },
      ],
      rows: layers,
      summary: `${layers.length} layers ${ui.icons.bullet} run \`${formatCommand("layer show <name>")}\` for details`,
      empty: "No layers found.",
    });
  });

layerCmd
  .command("show")
  .argument("[name]", "Layer name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .description("Show layer details, resources, and plugin pins")
  .action(async (name: string | undefined, opts: { format?: string; showId?: boolean; interactive?: boolean; noInteractive?: boolean }) => {
    const resolvedName = name ?? await resolveLayerMutationTarget({
      layerName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which layer do you want to show?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listDesignPlugins().length > 0
          ? "error: missing required argument 'name'"
          : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
      );
      return;
    }
    handleLayerShowCommand(resolvedName, opts);
  });

layerCmd
  .command("attach")
  .argument("[layer]", "Layer name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type when selector omits prefix: ${LAYER_ATTACHMENT_TYPES.join(", ")}`)
  .option("--version <constraint>", "Version constraint for plugin or layer attachments")
  .option("--embed", "Mark plugin resource as embed-on-export")
  .option("--sync", "Sync plugin resource immediately after attach (default: lazy)")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Attach a resource, plugin, or layer reference to a layer")
  .action(async (layerName: string | undefined, selector: string | undefined, opts: { type?: string; version?: string; embed?: boolean; sync?: boolean; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const layerTarget = await resolveLayerMutationTarget({
        layerName,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which layer do you want to update?",
      });
      if (!layerTarget) {
        process.exitCode = 1;
        ui.danger(
          listDesignPlugins().length > 0
            ? "error: missing required argument 'layer'"
            : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
        );
        return;
      }

      const layer = getPlugin(layerTarget);
      if (!layer) {
        process.exitCode = 1;
        ui.danger(`Layer not found: ${layerTarget}`);
        return;
      }

      const attachmentType = validateLayerAttachmentType(opts.type);

      const wizardValues = await runLayerAddWizard({
        selector,
        type: attachmentType,
        version: opts.version,
        embed: opts.embed,
        layerName: layer.name,
        shouldPrompt: shouldUseWizard({
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format: parseOutputFormat(opts.format),
          missingRequiredArgs: !layerName || !selector,
        }),
      });

      if (!wizardValues.selector) {
        throw new Error(`error: missing required argument 'selector'`);
      }

      ui.success(ui.theme.accent(await addLayerAttachment({
        layer,
        selector: wizardValues.selector,
        type: wizardValues.type,
        version: wizardValues.version,
        embed: wizardValues.embed ?? opts.embed,
        sync: opts.sync,
      })));
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

layerCmd
  .command("detach")
  .argument("[layer]", "Layer name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type: ${LAYER_ATTACHMENT_TYPES.join(", ")}`)
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Remove a resource, plugin, or layer reference from a layer")
  .action(async (layerName: string | undefined, selector: string | undefined, opts: { type?: string; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const layerTarget = await resolveLayerMutationTarget({
        layerName,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which layer do you want to update?",
      });
      if (!layerTarget) {
        process.exitCode = 1;
        ui.danger(
          listDesignPlugins().length > 0
            ? "error: missing required argument 'layer'"
            : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
        );
        return;
      }

      const layer = getPlugin(layerTarget);
      if (!layer) {
        process.exitCode = 1;
        ui.danger(`Layer not found: ${layerTarget}`);
        return;
      }

      const attachmentType = validateLayerAttachmentType(opts.type);

      const wizardValues = await runLayerAddWizard({
        selector,
        type: attachmentType,
        layerName: layer.name,
        shouldPrompt: shouldUseWizard({
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format: parseOutputFormat(opts.format),
          missingRequiredArgs: !layerName || !selector,
        }),
      });

      if (!wizardValues.selector) {
        throw new Error(`error: missing required argument 'selector'`);
      }

      const result = removeLayerAttachment({
        layer,
        selector: wizardValues.selector,
        type: wizardValues.type ?? attachmentType,
      });
      if (!result.removed && attachmentType === "layer") {
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

layerCmd
  .command("delete")
  .argument("[name]", "Layer name, name@version selector, or ID")
  .option("-s, --search <query>", "Filter layers in the delete wizard")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (name: string | undefined, opts: { search?: string; interactive?: boolean; noInteractive?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      const useWizard = shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      });
      const selectors = name
        ? [name]
        : useWizard
          ? await runLayerDeleteWizard({ search: opts.search })
          : [];

      if (selectors.length === 0) {
        throw new Error(
          !name && useWizard
            ? "No layers selected for deletion"
            : "Layer name is required",
        );
      }

      for (const resolvedName of selectors) {
        const layer = getPlugin(resolvedName);
        if (!layer) {
          process.exitCode = 1;
          ui.danger(`Layer not found: ${resolvedName}`);
          return;
        }
        if (!deletePlugin(layer.id)) {
          throw new Error(`Failed to delete layer ${formatLayerLabel(layer)}`);
        }
        ui.success(`Deleted layer ${ui.theme.accent(formatLayerLabel(layer))}`);
      }
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

layerCmd
  .command("export")
  .argument("<layer>", "Layer name/ID, or comma-separated layer list")
  .option("-f, --file <path>", "Output file path")
  .option(
    "--embed-plugins",
    "Also inline Claude marketplace-installed plugin trees when their install paths resolve from HOME",
  )
  .description("Export a layer as a shareable JSON bundle")
  .action(handleLayerExportCommand);

layerCmd
  .command("import")
  .argument("<file>", "JSON bundle file to import")
  .description("Import a layer from a JSON bundle file")
  .action(handleLayerImportCommand);

layerCmd
  .command("search")
  .argument("<query>", "Search query for layers on the cloud catalog")
  .option("--profile <name>", "Cloud profile to use")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Search remote layer libraries")
  .action(handleLayerSearchCommand);

const layerCatalogCmd = layerCmd
  .command("catalog")
  .description("Manage connected remote catalog sources");

layerCatalogCmd
  .command("list")
  .alias("ls")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show default and connected catalog sources")
  .action(async (opts: { baseUrl?: string; format?: string }) => {
    try {
      await handleLayerCatalogListCommand({
        baseUrl: opts.baseUrl,
        format: parseOutputFormat(opts.format),
      });
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("connect")
  .argument("<target>", "org <slug> or library <org/library>")
  .argument("[value]", "Organization slug or org/library selector")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .description("Connect an org or individual public library to the local catalog scope")
  .action(async (target: string, value: string | undefined, opts: { baseUrl?: string }) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org connect");
          return;
        }
        await handleLayerCatalogConnectOrgCommand(value, opts);
        return;
      }
      if (target === "library") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/library' for library connect");
          return;
        }
        await handleLayerCatalogConnectLibraryCommand(value, opts);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'library'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("disconnect")
  .argument("<target>", "org <slug> or library <org/library>")
  .argument("[value]", "Organization slug or org/library selector")
  .description("Disconnect a connected org or library from the local catalog scope")
  .action(async (target: string, value: string | undefined) => {
    try {
      if (target === "org") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'slug' for org disconnect");
          return;
        }
        await handleLayerCatalogDisconnectOrgCommand(value);
        return;
      }
      if (target === "library") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/library' for library disconnect");
          return;
        }
        await handleLayerCatalogDisconnectLibraryCommand(value);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'library'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCmd
  .command("add")
  .argument("[selector]", "Remote library selector: org/library[@version] or library[@version] with --org")
  .option("--as <name>", "Add under a different local layer name")
  .option("--org <slug>", "Organization slug (when selector omits org)")
  .option("--version <constraint>", "Version constraint (when selector omits version)")
  .option("--profile <name>", "Cloud profile to use")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Add a layer from the remote catalog into the local DB")
  .action(handleLayerInstallCommand);

layerCmd
  .command("publish")
  .argument("<layer>", "Local layer name to publish")
  .option("--org <slug>", "Organization slug to publish under")
  .option("--profile <name>", "Cloud profile to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a local layer to the cloud catalog")
  .action(handleLayerPublishCommand);

layerCmd
  .command("diff")
  .argument("<left>", "Layer name or bundle file")
  .argument("<right>", "Layer name or bundle file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two layers or a layer and a bundle file")
  .action(handleLayerDiffCommand);

layerCmd
  .command("doctor")
  .argument("[name]", "Layer name or ID")
  .option("--check <name>", "Run only the named check", (value, previous: string[] = []) => [...previous, value], [])
  .option("--list-checks", "List available checks")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Run doctor checks against a layer")
  .action(handleLayerDoctorCommand);

layerCmd
  .command("from-project")
  .argument("[name]", "New layer name")
  .option("--project <path>", "Project directory", ".")
  .option("-d, --description <text>", "Layer description")
  .option("-p, --platform <slug>", "Scan only a specific platform")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Scan current folder and create a layer from its resources")
  .action(handleLayerFromProjectCommand);

layerCmd
  .command("set-environment")
  .argument("<layer>", "Configured layer name or ID")
  .argument("<environment>", "Environment name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Set default environment for a configured layer")
  .action((layer: string, environment: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const result = setLayerEnvironmentCommand(layer, environment);
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(`Set default environment on ${ui.theme.accent(layer)}`);
  });

layerCmd
  .command("unset-environment")
  .argument("<layer>", "Configured layer name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Clear default environment from a configured layer")
  .action((layer: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const result = unsetLayerEnvironmentCommand(layer);
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(`Cleared default environment on ${ui.theme.accent(layer)}`);
  });

// ── environment ──────────────────────────────────────────────────────────

const environmentCmd = configureCommandGroup(
  program
    .command("environment")
    .alias("e")
    .description("Manage reusable environments and project environment cascade"),
);

environmentCmd
  .command("create")
  .argument("<name>", "Environment name")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const created = createEnvironmentCommand({ name });
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(created);
      return;
    }
    ui.success(`Created environment ${ui.theme.accent(created.name)}`);
  });

environmentCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const environments = listEnvironmentsCommand();
    if (format === "json") {
      printJson(environments);
      return;
    }
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 24 },
        { key: "value_count", header: "VALUES", width: 8 },
        { key: "secret_ref_count", header: "SECRETS", width: 8 },
        { key: "reference_count", header: "REFS", width: 8 },
      ],
      rows: environments.map((entry) => ({
        name: entry.environment.name,
        value_count: entry.value_count,
        secret_ref_count: entry.secret_ref_count,
        reference_count: entry.reference_count,
      })),
      empty: "No environments found.",
    });
  });

environmentCmd
  .command("show")
  .argument("<name>", "Environment name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = showEnvironmentCommand(name);
    const format = parseOutputFormat(opts.format);
    printEnvironmentMutationResult(payload, format);
  });

environmentCmd
  .command("delete")
  .argument("<name>", "Environment name or ID")
  .option("--force", "Delete even if references exist")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { force?: boolean; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const result = deleteEnvironmentCommand(name, { force: opts.force });
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(`Deleted environment ${ui.theme.accent(name)}`);
  });

environmentCmd
  .command("set")
  .argument("<name>", "Environment name or ID")
  .option("--var <keyValue>", "Set env var KEY=VALUE", (value, previous: string[] = []) => [...previous, value], [])
  .option("--model <name>", "Set default model name")
  .option("--provider <provider>", "Provider for --model")
  .option("--permission <actionPattern>", "Set permission action:pattern", (value, previous: string[] = []) => [...previous, value], [])
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { var?: string[]; model?: string; provider?: string; permission?: string[]; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    let lastPayload: ReturnType<typeof showEnvironmentCommand> | undefined;
    for (const entry of opts.var ?? []) {
      const parsed = parseVarAssignment(entry);
      lastPayload = setEnvironmentVarCommand(name, parsed.key, parsed.value);
    }
    if (opts.model) {
      lastPayload = setEnvironmentModelConfigCommand(name, {
        model: opts.model,
        ...(opts.provider ? { provider: opts.provider } : {}),
      });
    }
    for (const entry of opts.permission ?? []) {
      const parsed = parsePermissionPattern(entry);
      lastPayload = setEnvironmentPermissionCommand(name, parsed);
    }
    const payload = lastPayload ?? showEnvironmentCommand(name);
    const format = parseOutputFormat(opts.format);
    printEnvironmentMutationResult(payload, format);
  });

environmentCmd
  .command("unset")
  .argument("<name>", "Environment name or ID")
  .option("--var <key>", "Unset env var key", (value, previous: string[] = []) => [...previous, value], [])
  .option("--model [name]", "Unset model config (default when omitted)")
  .option("--permission <selector>", "Unset permission action:pattern or name", (value, previous: string[] = []) => [...previous, value], [])
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { var?: string[]; model?: string | boolean; permission?: string[]; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    let lastPayload: ReturnType<typeof showEnvironmentCommand> | undefined;
    for (const key of opts.var ?? []) {
      lastPayload = unsetEnvironmentVarCommand(name, key);
    }
    if (opts.model !== undefined) {
      const modelName =
        typeof opts.model === "string" && opts.model.length > 0
          ? opts.model
          : "default";
      lastPayload = unsetEnvironmentModelConfigCommand(name, modelName);
    }
    for (const entry of opts.permission ?? []) {
      lastPayload = unsetEnvironmentPermissionCommand(
        name,
        parsePermissionUnsetSelector(entry),
      );
    }
    const payload = lastPayload ?? showEnvironmentCommand(name);
    const format = parseOutputFormat(opts.format);
    printEnvironmentMutationResult(payload, format);
  });

const environmentSecretCmd = configureCommandGroup(
  environmentCmd
    .command("secret")
    .description("Manage environment secret references"),
);

environmentSecretCmd
  .command("set")
  .argument("<name>", "Environment name or ID")
  .argument("<key>", "Secret key")
  .requiredOption("--provider <provider>", "Secret provider keychain|env|file")
  .requiredOption("--ref <value>", "Reference value for provider")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, key: string, opts: { provider: "keychain" | "env" | "file"; ref: string; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = setEnvironmentSecretCommand(name, {
      key,
      provider: opts.provider,
      ref: opts.ref,
    });
    const format = parseOutputFormat(opts.format);
    printEnvironmentMutationResult(payload, format);
  });

environmentSecretCmd
  .command("unset")
  .argument("<name>", "Environment name or ID")
  .argument("<key>", "Secret key")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, key: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = unsetEnvironmentSecretCommand(name, key);
    const format = parseOutputFormat(opts.format);
    printEnvironmentMutationResult(payload, format);
  });

environmentCmd
  .command("capture")
  .argument("<name>", "Environment name")
  .requiredOption("--project <path>", "Project directory")
  .option("--layers <layers...>", "Configured layer selectors")
  .option("--include-permissions", "Capture scanned permission resources")
  .option("--dry-run", "Preview capture without persisting")
  .option("--strict", "Fail when required keys are missing")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (
    name: string,
    opts: {
      project: string;
      layers?: string[];
      includePermissions?: boolean;
      dryRun?: boolean;
      strict?: boolean;
      format?: string;
    },
  ) => {
    await handleEnvironmentCaptureCommand("capture", name, opts);
  });

environmentCmd
  .command("refresh")
  .argument("<name>", "Environment name")
  .requiredOption("--project <path>", "Project directory")
  .option("--layers <layers...>", "Configured layer selectors")
  .option("--include-permissions", "Capture scanned permission resources")
  .option("--dry-run", "Preview refresh without persisting")
  .option("--strict", "Fail when required keys are missing")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (
    name: string,
    opts: {
      project: string;
      layers?: string[];
      includePermissions?: boolean;
      dryRun?: boolean;
      strict?: boolean;
      format?: string;
    },
  ) => {
    await handleEnvironmentCaptureCommand("refresh", name, opts);
  });

environmentCmd
  .command("use")
  .argument("<name>", "Environment name or ID")
  .option("--project <path>", "Project directory")
  .option("--reapply", "Reapply last configured project layers after switching")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (name: string, opts: { project?: string; reapply?: boolean; format?: string }) => {
    await handleEnvironmentUseCommand(name, opts);
  });

environmentCmd
  .command("active")
  .option("--project <path>", "Project directory")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { project?: string; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const projectRoot = opts.project ? resolve(opts.project) : undefined;
    const configuredLayerIds = (() => {
      if (!projectRoot) return [] as string[];
      const project = getProjectByLocalPath(projectRoot);
      if (!project) return [] as string[];
      return getProjectConfiguredLayers(project.id).map(
        (row) => row.configured_layer_id,
      );
    })();
    const payload = environmentActivePayload({
      ...(projectRoot ? { projectRoot } : {}),
      configuredLayerIds,
    });
    if (format === "json") {
      printJson(payload);
      return;
    }
    ui.panel({
      title: ["ENVIRONMENT", "active"],
      rows: [
        ["Project", projectRoot ?? "(none)"],
        ["Resolved vars", `${Object.keys(payload.resolved.vars).length}`],
        ["Resolved secrets", `${Object.keys(payload.resolved.secretRefs).length}`],
      ],
    });
    ui.info(JSON.stringify(payload, null, 2));
  });

environmentCmd
  .command("resolve")
  .requiredOption("--project <path>", "Project directory")
  .option("--layers <layers...>", "Configured layer selectors")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { project: string; layers?: string[]; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const projectRoot = resolve(opts.project);
    const configuredLayerIds = resolveConfiguredLayersForCascade(
      projectRoot,
      opts.layers,
    );
    const payload = environmentResolvePayload({
      projectRoot,
      configuredLayerIds,
    });
    if (format === "json") {
      printJson(payload);
      return;
    }
    ui.panel({
      title: ["ENVIRONMENT", "resolve"],
      rows: [
        ["Project", projectRoot],
        ["Layer defaults", `${payload.layer_defaults.length}`],
        ["Resolved vars", `${Object.keys(payload.resolved.vars).length}`],
        ["Resolved secrets", `${Object.keys(payload.resolved.secretRefs).length}`],
      ],
    });
    ui.info(JSON.stringify(payload, null, 2));
  });

environmentCmd
  .command("import")
  .argument("<file>", "Environment JSON/JSONC file")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((file: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const raw = readFileSync(resolve(file), "utf-8");
    const result = importEnvironmentJsonc(raw);
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(
      `Imported environment ${ui.theme.accent(result.environment.name)} ${ui.icons.bullet} ${result.imported_keys.length} vars`,
    );
  });

environmentCmd
  .command("export")
  .argument("<name>", "Environment name or ID")
  .argument("[file]", "Output file path")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, file: string | undefined, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const payload = exportEnvironmentJsonc(name);
    if (file) {
      const outPath = resolve(file);
      writeFileSync(outPath, payload.jsonc, "utf-8");
      if (format === "json") {
        printJson({ environment: payload.environment, file: outPath });
        return;
      }
      ui.success(
        `Exported environment ${ui.theme.accent(payload.environment.name)} ${ui.icons.hint} ${outPath}`,
      );
      return;
    }
    if (format === "json") {
      printJson(payload.environment);
      return;
    }
    console.log(payload.jsonc);
  });

// ── migrate ─────────────────────────────────────────────────────────────

const migrateCmd = configureCommandGroup(
  program
    .command("migrate")
    .description("Export or import full HarnessDeck state for machine migration"),
);

migrateCmd
  .command("export")
  .argument("<file>", "Output archive path (.tar.gz or .json)")
  .option("--include-plugins", "Embed plugin trees in layer bundles")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Export all layers, harness preferences, and config")
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
  .argument("[type]", `Filter by resource type (${RESOURCE_TYPES.join(", ")})`)
  .option("-t, --type <type>", "Filter by resource type")
  .option("-s, --search <query>", "Search by name or description (skips interactive filter)")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in human-readable tables")
  .option("--all", "Show all resources per type (default: first 10 per type)")
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
  .argument("<resource>", "Resource name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .option("--all-fields", "Show all resource metadata fields")
  .action((resource: string, opts: { format?: string; showId?: boolean; allFields?: boolean }) => {
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
      ui.danger(
        !resource && useWizard
          ? "No resources selected for deletion"
          : "Resource name is required",
      );
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

// ── project ─────────────────────────────────────────────────────────────

const projectCmd = configureCommandGroup(
  program
    .command("project")
    .alias("p")
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
  .option("--overwrite", "Overwrite library resources when scan content differs")
  .option("--skip-existing", "Keep existing library resources when scan content differs")
  .option("--namespace <name>", "Namespace for imported project resources")
  .description(
    "Scan a project directory or plugin source and import configurations into the database",
  )
  .action(handleScanCommand);

projectCmd
  .command("apply")
  .argument(
    "[layers...]",
    "Layer name(s), bundle path, or URL (multiple layers are merged in order)",
  )
  .option("--project <path>", "Project directory", ".")
  .option(
    "--harness <slugs>",
    "Comma-separated harness slugs (defaults to project or global harness preference)",
  )
  .option("--platform <slugs>", "Alias for --harness")
  .option("--dry-run", "Show what would be written")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .option(
    "--ignore-plugin-versions",
    "Skip validating layer Claude plugin pins against installed versions",
  )
  .option(
    "--strict-plugin-versions",
    "Fail apply (exit 2) if any pinned plugin violates its version constraint",
  )
  .option(
    "--sync-plugins",
    "Refresh all pinned plugin resources from install trees before apply (unresolved plugins are synced by default)",
  )
  .description(
    "Apply one or more layers (or a bundle URL) to a project, serializing for each harness",
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
    if (isPromptCancellationError(error)) {
      return;
    }

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
    if (isPromptCancellationError(error)) {
      process.exitCode = 0;
    } else {
      process.exitCode =
        error && typeof error === "object" && "exitCode" in error
          ? Number((error as { exitCode?: unknown }).exitCode) || 1
          : 1;
      renderCliError(error);
    }
  }
}
