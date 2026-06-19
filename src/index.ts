import { Command } from "commander";
import { PACKAGE_VERSION } from "./version.js";
import { getDb, closeDb, getDbPath, getHarnessdeckDir } from "./db/connection.js";
import { initializeSchema } from "./db/schema.js";
import { ui } from "./ui/index.js";
import {
  projectStatusPayloadToJson,
  renderProjectStatusHuman,
} from "./ui/project-status-render.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "./services/git.js";
import {
  type scanProject,
  type persistScanResults,
  applyScanConflicts,
  detectPlatforms,
  isPluginSourcePath,
  scanProjectWithPluginSource,
  persistMergedProjectScan,
  scanAndPersistPluginSource,
  scanAndPersistHomeDefaults,
} from "./services/scanner.js";
import { dropHarnessSkillsDuplicatingPluginSource } from "./services/scan-dedup.js";
import { syncLinkedResources } from "./services/resource-sync.js";
import type { ImportConflictPolicy } from "./models/resource.js";
import {
  applyImportedSnapshotToGlobal,
  generateFiles,
  materializeFiles,
  writeFiles,
} from "./services/applier.js";
import { exportLayer, inspectLayerExportFile } from "./services/layer-export.js";
import { importFromFile } from "./services/layer-import.js";
import { formatLayerExportToml } from "./services/transport/index.js";
import {
  listResources,
  deleteResource,
  resolveResource,
} from "./models/resource.js";
import {
  createLayer,
  getLayer,
  listLayers,
  deleteLayer,
  addResourceToLayer,
  getLayerResources,
  listLayerDependencies,
  parseLayerSelectorString,
  getLayerById,
  resolveLayerSelector,
  mergeLayersById,
} from "./models/layer-model.js";
import {
  upsertProject,
  getProject,
  getProjectByLocalPath,
  getProjectByOrigin,
  applyConfiguredLayerToProject,
  getProjectConfiguredLayers,
} from "./models/project.js";
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { listAttachedLayerRefs, listAttachedPluginPins } from "./services/layer-composition.js";
import type { PluginPinMetadata } from "./types.js";
import {
  getHarnessPreference,
  setHarnessPreference,
  getProjectHarnessConfig,
  setProjectHarnessConfig,
} from "./models/harness.js";
import { listImportedSnapshots } from "./models/imported-snapshot.js";
import { resolveHarnessSelection } from "./services/harness-config.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  resolveScanGlobalHarnessTargets,
  uniqueHarnessTargets,
} from "./services/harness-targets.js";
import { parseOutputFormat, printJson } from "./utils/output-format.js";
import { getCloudAccount, saveCloudAccount, setDefaultCloudAccount, updateCloudAccount, removeCloudAccount } from "./config/cloud-accounts.js";
import {
  deviceVerificationUri,
  requestDeviceCode,
  pollDeviceToken,
  createCloudClient,
} from "./services/cloud-client.js";
import {
  listLayersInScope,
} from "./services/catalog-client.js";
import {
  formatCatalogScopeLabel,
  resolveCatalogScope,
  resolveCloudBaseUrl,
} from "./config/catalog.js";
import {
  handleLayerCatalogConnectLayerCommand,
  handleLayerCatalogConnectOrgCommand,
  handleLayerCatalogDisconnectLayerCommand,
  handleLayerCatalogDisconnectOrgCommand,
  handleLayerCatalogListCommand,
  renderLayerSearchResults,
} from "./services/layer-catalog.js";
import { runInteractiveCatalogBrowser } from "./services/wizards/interactive-catalog-browser.js";
import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "./constants/onboarding.js";
import { PROFILE_LAYER_TAG, isProfileLayer } from "./constants/profile.js";
import { buildHelpCommandPayload, printHelpCommand } from "./services/concepts-guide.js";
import { catalogAliasHint } from "./services/catalog-aliases.js";
import { maybePromptInitCatalogInstall } from "./services/init-catalog-prompt.js";
import {
  loadScenarioGuide,
  parseScenarioId,
} from "./services/scenario-guide.js";
import { renderShellCompletion } from "./services/shell-completion.js";
import { runCompleteCommand } from "./services/completion/run-complete.js";
import {
  formatPublishedSelector,
  resolveRemoteLayerSelector,
} from "./services/layer-selector.js";
import {
  preparePluginPinsForApply,
  type SyncPluginPinsForApplyResult,
} from "./services/plugin-pin-apply.js";
import { resolvePluginInstallScope, type InstallPluginPinResult } from "./services/plugin-install.js";
import { resolveClaudeEnabledPluginRef } from "./plugins/claude-plugin-ref.js";
import { detectProjectDriftFromLatest } from "./services/project-drift.js";
import { buildProjectStatusPayload } from "./services/project-status-payload.js";
import { diffLayers } from "./services/layer-diff.js";
import { listLayerDoctorChecks, runLayerDoctor } from "./services/layer-doctor.js";
import { mergeLayersForApply } from "./services/layer-apply-merge.js";
import { updateLayerPublishedIdentity } from "./models/layer-model.js";
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
  exportEnvironmentToml,
  importEnvironmentToml,
} from "./services/environment-import-export.js";
import { createLayerFromProject } from "./services/layer-from-project.js";
import { resolveApplyLayerSource } from "./services/layer-apply-source.js";
import { LayerAmbiguityError, LayerResolveError } from "./services/layer-bare-name-resolve.js";
import { installLayerFromCatalog } from "./services/layer-catalog-install.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "./services/materialization-conflicts.js";
import {
  addApplyCommandOptions,
  type ApplyCommandOpts,
} from "./services/apply-command-options.js";
import { syncProject, type ProjectReferenceStrategy } from "./services/project-sync.js";
import { scanPluginSource } from "./services/plugin-source-import.js";
import {
  LAYER_ATTACHMENT_TYPES,
  LayerAttachmentHintError,
  validateLayerAttachmentType,
} from "./services/layer-composition.js";
import {
  exportScopedMigration,
  importScopedMigration,
  resolveExportScope,
  resolveImportScope,
  type ScopedExportResult,
  type ScopedImportResult,
} from "./services/migrate-scope.js";
import { runMigrateExportWizard } from "./services/wizards/migrate-export.js";
import { runMigrateImportWizard } from "./services/wizards/migrate-import.js";
import {
  createProfileCommand,
  getActiveProfilePayload,
  listProfileLayersCommand,
  showProfileCommand,
  tagProfileCommand,
  untagProfileCommand,
  useProfileCommand,
} from "./services/profile-commands.js";
import { setActiveProfileName } from "./services/active-profile.js";
import { createProgress, type ProgressHandle } from "./ui/progress.js";
import {
  isPromptCancellationError,
  promptForChoice,
  promptForSearchableChoice,
  promptForValue,
  resolveOrPrompt,
  shouldUseWizard,
} from "./services/wizards/shared.js";
import {
  toLayerChoices,
  toResourceChoices,
} from "./services/completion/choices.js";
import {
  applyLayerEdit,
  applyLayerEditScripting,
  attachmentKey,
  buildLayerEditCandidates,
  buildPendingFromApplySpec,
  parseLayerEditApplyFile,
} from "./services/layer-edit.js";
import { runLayerEditWizard } from "./services/wizards/layer-edit.js";
import { runLayerDeleteWizard } from "./services/wizards/layer-delete.js";
import { runLayerFromProjectWizard } from "./services/wizards/layer-from-project.js";
import { runLayerApplyWizard } from "./services/wizards/layer-apply.js";
import { runResourceDeleteWizard } from "./services/wizards/resource-delete.js";
import { printResourceShow } from "./services/resource-show.js";
import { runResourceListWizard } from "./services/wizards/resource-list.js";
import { runAddPackageWizard } from "./services/wizards/add-package.js";
import { addSkillPackage } from "./services/add-package.js";
import { discoverSkillPackage } from "./services/skill-discovery.js";
import { classifyRepo } from "./services/repo-profile.js";
import {
  resolveRemoteSource,
  sourceCacheDir,
} from "./services/source-resolver.js";
import { refreshGitSource } from "./plugins/refresh.js";
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

function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const GUIDE_SCENARIOS_URL =
  "https://github.com/harnessdeck/harnessdeck/blob/main/docs/scenarios/scenarios.md";

const GIT_ORIGIN_HINTS = [
  "Add a remote: git remote add origin <url>",
  "Snapshots, drift, history, and revert require a git repository with origin configured.",
];

function reportNoGitOrigin(retryCommand?: string): void {
  process.exitCode = 1;
  const hints = [...GIT_ORIGIN_HINTS];
  if (retryCommand) {
    hints.push(`Then retry: ${retryCommand}`);
  }
  ui.danger("No git remote origin configured.", { hints });
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
  const format = parseOutputFormat(input.format);
  const choices = toLayerChoices();

  return resolveOrPrompt({
    value: input.layerName,
    shouldPrompt: shouldUseWizard({
      interactive: input.interactive,
      noInteractive: input.noInteractive,
      format,
      missingRequiredArgs: !input.layerName,
    }),
    prompt: async () => {
      if (choices.length === 0) {
        return undefined;
      }
      return promptForSearchableChoice({
        message: input.message,
        choices,
      });
    },
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
  const parsed = parseLayerSelectorString(dependencyName);
  if (parsed.kind === "id") return dependencyName;
  return parsed.name;
}

function resolveDependencyLayerVersion(
  dependencyName: string,
  versionConstraint: string,
): string {
  const name = dependencyLayerName(dependencyName);
  const resolved = getLayer(`${name}@${versionConstraint}`);
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

function isLayerAttachmentOnlyType(type: string | undefined): boolean {
  if (!type) {
    return false;
  }
  if (type === "layer-dependency") {
    return true;
  }
  return type === "plugin_pin" || type === "layer";
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

function isHiddenHelpCommand(command: Command): boolean {
  return (
    command.name() === "__complete"
    || (command.description() as unknown) === false
  );
}

function isCommandGroup(command: Command): boolean {
  return command.commands.some((sub) => !isHiddenHelpCommand(sub));
}

function renderTopLevelCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((command) => !isHiddenHelpCommand(command));
  const groups = commands.filter(isCommandGroup);
  const direct = commands.filter((command) => !isCommandGroup(command));

  const sections = [
    renderCommandSection("COMMAND GROUPS", groups),
    renderCommandSection("PROJECT", direct),
  ].filter((section) => section.length > 0);

  return sections.join("\n\n");
}

function renderGroupedCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((command) => !isHiddenHelpCommand(command));

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

const LAYER_HELP_LOCAL_COMMANDS = new Set([
  "create",
  "list",
  "show",
  "edit",
  "delete",
  "export",
  "import",
  "apply",
  "diff",
  "doctor",
  "from-project",
]);

const LAYER_HELP_REMOTE_COMMANDS = new Set([
  "search",
  "catalog",
  "pull",
  "publish",
]);

function renderCommandSection(title: string, commands: Command[]): string {
  if (commands.length === 0) {
    return "";
  }

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
  const maxNameLength = Math.max(...commandStrs.map((entry) => entry.length));
  const lines = [ui.theme.heading(title)];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const nameStr = commandStrs[i];
    if (!command || !nameStr) {
      continue;
    }
    const padding = " ".repeat(Math.max(2, maxNameLength - nameStr.length + 2));
    lines.push(`  ${ui.theme.command(nameStr)}${padding}${command.description() || ""}`);
  }
  return lines.join("\n");
}

function renderLayerGroupedCommandHelp(cmd: Command): string {
  const local = cmd.commands.filter((command) =>
    LAYER_HELP_LOCAL_COMMANDS.has(command.name()),
  );
  const remote = cmd.commands.filter((command) =>
    LAYER_HELP_REMOTE_COMMANDS.has(command.name()),
  );
  return [
    renderCommandSection("LOCAL LIBRARY", local),
    "",
    renderCommandSection("REMOTE CATALOG", remote),
  ].join("\n");
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
    && /too many arguments for '(layer|resource|plugin|auth|migrate|harness|environment|profile)'/i.test(candidate.message);
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

        const args = cmd.registeredArguments?.filter((arg) => arg.description) ?? [];
        if (args.length > 0) {
          lines.push(ui.theme.heading("ARGUMENTS"));
          for (const arg of args) {
            const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
            lines.push(`  ${ui.theme.flag(name)}  ${arg.description}`);
          }
          lines.push("");
        }

        if (cmd.name() === "completion") {
          lines.push(ui.theme.heading("EXAMPLES"));
          lines.push(`  ${formatCommand("completion bash >> ~/.bashrc")}`);
          lines.push(`  ${formatCommand("completion zsh >> ~/.zshrc")}`);
          lines.push(`  ${formatCommand("completion fish > ~/.config/fish/completions/hd.fish")}`);
          lines.push("");
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
        
        const subcommands = cmd.name() === "layer"
          ? renderLayerGroupedCommandHelp(cmd)
          : renderGroupedCommandHelp(cmd);
        if (subcommands) {
          if (cmd.name() !== "layer") {
            lines.push(ui.theme.heading("COMMANDS"));
          }
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
        renderTopLevelCommandHelp(cmd),
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

function printHarnessScanDryRun(
  results: Awaited<ReturnType<typeof scanProject>>,
): void {
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

  if (detected.length === 0) {
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
    printHarnessScanDryRun(harness);
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

  for (const result of merged.scan.harness) {
    const importedCount = harnessPersisted.importedCounts.get(result.platformId) ?? 0;
    ui.success(`${result.platformId} ${ui.icons.bullet} ${formatCount(importedCount, "resource")}`);
    for (const resource of result.resources) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${resource.type} ${resource.name}`));
    }
  }

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
  options: {
    onFetched?: (sourceLabel: string) => void;
  } = {},
): Promise<{
  layers: ReturnType<typeof getLayer>[];
  resources: Resource[];
  claude?: import("./types.js").ClaudeLayerConfig;
  configuredLayerIds: string[];
  primaryConfiguredLayerId: string;
}> {
  function importedBundleToApplyResult(imported: ReturnType<typeof importFromFile>) {
    const layers = imported.layers.map((entry) => entry.layer);
    const primaryLayer = layers[layers.length - 1];
    if (!primaryLayer) {
      throw new Error("Bundle contains no layers.");
    }
    const merged = mergeLayersById(layers.map((layer) => layer.id));
    const layer = getLayerById(primaryLayer.id);
    if (!layer) throw new Error(`Layer not found: ${primaryLayer.id}`);
    return {
      layers: merged.layers,
      resources: merged.resources,
      claude: merged.claude,
      configuredLayerIds: [layer.id],
      primaryConfiguredLayerId: layer.id,
    };
  }

  const resolvedSources = await Promise.all(
    layerNames.map((selector) =>
      resolveApplyLayerSource(selector, { onFetched: options.onFetched }),
    ),
  );

  if (
    resolvedSources.length === 1
    && resolvedSources[0]?.kind === "layer-export"
  ) {
    const layerExportPath = resolvedSources[0].path;
    const summary = inspectLayerExportFile(layerExportPath);
    const primarySummary = summary.layers[summary.layers.length - 1];
    if (primarySummary) {
      const selector = primarySummary.version
        ? `${primarySummary.name}@${primarySummary.version}`
        : primarySummary.name;
      const existingLayer = resolveLayerSelector(selector);
      if (existingLayer) {
        const layer = getLayerById(existingLayer.id);
        if (!layer) throw new Error(`Layer not found: ${existingLayer.id}`);
        const merged = mergeLayersForApply([layer.id]);
        return {
          layers: merged.layers,
          resources: merged.resources,
          claude: merged.claude,
          configuredLayerIds: [layer.id],
          primaryConfiguredLayerId: layer.id,
        };
      }
    }

    return importedBundleToApplyResult(
      importFromFile(layerExportPath, {
        embeddedTargetDir: projectRoot,
      }),
    );
  }

  const configuredLayerIds = resolvedSources.map((source) => {
    if (source.kind === "layer-export") {
      throw new Error("Layer export paths and URLs cannot be mixed with layer selectors.");
    }
    const layer = getLayerById(source.layerId);
    if (!layer) throw new Error(`Layer not found: ${source.layerId}`);
    return layer.id;
  });
  const merged = mergeLayersForApply(configuredLayerIds);
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
  opts: ApplyCommandOpts,
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  const outputFormat = parseOutputFormat(opts.format);

  const resolvedLayerNames = layerNames.length > 0
    ? layerNames
    : await (shouldUseWizard({
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: parseOutputFormat(opts.format),
        missingRequiredArgs: true,
      })
        ? runLayerApplyWizard().then((layerName) => [layerName] as [string])
        : Promise.resolve([] as []));

  if (resolvedLayerNames.length === 0) {
    process.exitCode = 1;
    ui.danger(
      "Provide at least one layer name, layer export path, or URL.",
      {
        hints: [
          formatCommand("layer apply <layer>"),
        ],
      },
    );
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
      {
        onFetched:
          outputFormat === "human"
            ? (sourceLabel) => {
                ui.info(`Fetched ${sourceLabel} from catalog`);
              }
            : undefined,
      },
    );
  } catch (err) {
    resolveSpin.stop();
    process.exitCode = 1;
    if (err instanceof LayerResolveError || err instanceof LayerAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }
  resolveSpin.stop();

  const primaryLayer = applyBundle.layers[applyBundle.layers.length - 1];
  if (!primaryLayer) {
    process.exitCode = 1;
    ui.danger("No layer resolved for apply");
    return;
  }

  let platforms: string[];
  try {
    platforms = resolveApplyHarnessTargets(
      projectRoot,
      opts.harness,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return;
  }

  if (platforms.length === 0) {
    process.exitCode = 1;
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
      for (const plugin of listAttachedPluginPins(layer.id)) {
        pins.set(plugin.ref, {
          ref: plugin.ref,
          version_constraint: plugin.version_constraint,
        });
      }
    }
    return [...pins.values()];
  })();

  const skipPluginSync =
    opts.ignorePluginVersions || mergedPluginPins.length === 0 || opts.dryRun;
  let applyResources = resources;
  let pluginValidationIssues: Awaited<
    ReturnType<typeof preparePluginPinsForApply>
  >["validationIssues"] = [];

  if (!skipPluginSync) {
    console.log(ui.theme.muted("Plugins"));
  }
  const pluginProgressState: { current: ProgressHandle | null } = { current: null };

  const pluginPrepare = await preparePluginPinsForApply({
    pins: mergedPluginPins,
    baseResources: resources,
    projectRoot,
    skipSync: skipPluginSync,
    syncAll: opts.syncPlugins,
    scope: resolvePluginInstallScope(projectRoot, Boolean(getGitOrigin(projectRoot))),
    ignoreMissingInstall: opts.ignorePluginVersions,
    progress: skipPluginSync
      ? undefined
      : {
          onInstallStart: (ref) => {
            pluginProgressState.current?.stop();
            pluginProgressState.current = createProgress(`Installing ${ref}…`);
          },
          onInstallComplete: (install) => {
            pluginProgressState.current?.stop();
            pluginProgressState.current = null;
            printPluginInstallLine(install);
          },
          onSyncStart: (ref) => {
            pluginProgressState.current?.stop();
            pluginProgressState.current = createProgress(`Syncing ${ref}…`);
          },
          onSyncComplete: () => {
            pluginProgressState.current?.stop();
            pluginProgressState.current = null;
          },
        },
  });
  pluginProgressState.current?.stop();

  applyResources = pluginPrepare.applyResources;
  pluginValidationIssues = pluginPrepare.validationIssues;

  if (!skipPluginSync) {
    printPluginApplyPostSyncSummary(pluginPrepare, pluginPrepare.extraMaterialized);

    if (pluginPrepare.unresolvedPins.length > 0) {
      for (const ref of pluginPrepare.unresolvedPins) {
        console.warn(
          ui.theme.warn(
            `Plugin pin ${ref} is not installed locally. Run: harnessdeck resource sync plugin_pin:${ref}`,
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
  const gitOriginForApply = getGitOrigin(projectRoot);
  const projectForHarness = gitOriginForApply
    ? getProjectByOrigin(normalizeGitUrl(gitOriginForApply))
    : undefined;
  const projectHarnessConfig = projectForHarness
    ? getProjectHarnessConfig(projectForHarness.id)
    : undefined;
  try {
    generated = await generateFiles(
      applyResources,
      platforms,
      projectRoot,
      {
        claudeConfig: resolvedClaude,
        resolvedEnvironment,
        ...(projectHarnessConfig?.cursor_skill_mode
          ? { skillCursorMode: projectHarnessConfig.cursor_skill_mode }
          : {}),
      },
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
    if (pluginValidationIssues.length > 0) {
      for (const issue of pluginValidationIssues) {
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
  } else if (outputFormat === "human" && !opts.dryRun) {
    ui.warn("No git remote origin — configuration snapshot will not be stored.");
    ui.hint("git remote add origin <url>");
    ui.hint("Snapshots and drift detection require a git repository with origin configured.");
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

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: opts.onConflict,
    noInteractive: opts.noInteractive,
  });
  const conflictResolver =
    conflictPolicy === "prompt" ? promptMaterializationConflict : undefined;

  for (const result of generated) {
    const spin = createProgress(`Applying ${result.platformId}…`);
    const materialized = await materializeFiles(result.files, projectRoot, {
      conflictPolicy,
      conflictResolver,
    });
    spin.stop();
    if (materialized.cancelled) {
      ui.danger("Apply cancelled due to file conflicts");
      process.exitCode = 1;
      return;
    }
    const writtenCount = materialized.writtenFiles.length;
    const skippedCount = materialized.skippedFiles.length;
    const summary =
      skippedCount > 0
        ? `wrote ${formatCount(writtenCount, "file")}, skipped ${formatCount(skippedCount, "file")}`
        : `wrote ${formatCount(writtenCount, "file")}`;
    console.log(
      ui.theme.success(
        `${ui.icons.success} ${result.platformId} ${ui.icons.bullet} ${summary}`,
      ),
    );
    for (const filePath of materialized.writtenFiles) {
      console.log(ui.theme.muted(`  ${ui.icons.bullet} ${filePath}`));
    }
    for (const filePath of materialized.skippedFiles) {
      console.log(
        ui.theme.muted(`  ${ui.icons.bullet} skipped ${filePath}`),
      );
    }
  }

  // Non-strict plugin warnings (shown after successful file writes).
  if (
    !opts.ignorePluginVersions &&
    !opts.strictPluginVersions &&
    mergedPluginPins.length > 0
  ) {
    for (const issue of pluginValidationIssues) {
      console.warn(ui.theme.warn(issue.message));
    }
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

function printMigrateExportHuman(result: ScopedExportResult): void {
  switch (result.scope) {
    case "workspace":
      ui.success(
        `Exported migration archive ${ui.icons.hint} ${result.output} ${ui.icons.bullet} ${result.manifest.layer_count} layers, ${result.manifest.environment_count} environments`,
      );
      return;
    case "layer":
      ui.success(
        `Exported layer ${ui.theme.accent(result.layers.join(", "))} ${ui.icons.hint} ${result.output}`,
      );
      return;
    case "resource":
      ui.success(
        `Exported resource ${ui.theme.accent(result.resource)} ${ui.icons.hint} ${result.output}`,
      );
      return;
    default: {
      const neverResult: never = result;
      throw new Error(`Unsupported export result: ${String(neverResult)}`);
    }
  }
}

function printMigrateImportHuman(result: ScopedImportResult): void {
  switch (result.scope) {
    case "workspace":
      ui.success(
        `Imported migration archive ${ui.icons.bullet} ${formatCount(result.layers_imported, "layer")}, ${formatCount(result.environments_imported, "environment")}`,
      );
      return;
    case "layer":
      ui.success(
        `Imported layer ${ui.theme.accent(result.layer)} ${ui.icons.bullet} ${formatCount(result.resources_imported, "resource")}`,
      );
      return;
    case "resource":
      ui.success(
        `Imported resource ${ui.theme.accent(result.resource)} ${ui.icons.bullet} ${result.action}`,
      );
      return;
    default: {
      const neverResult: never = result;
      throw new Error(`Unsupported import result: ${String(neverResult)}`);
    }
  }
}

async function resolveCloudClientForLayerCommand(accountName?: string) {
  const accountInfo = await getCloudAccount(accountName);
  const { account } = accountInfo;
  if (!account || !account.cloudBaseUrl) return undefined;
  const token = account.accessToken ? {
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expires_at: typeof account.accessTokenExpiresAt === 'string' ? Number(account.accessTokenExpiresAt) : (account.accessTokenExpiresAt as number | undefined),
  } : undefined;
  return createCloudClient({ baseUrl: account.cloudBaseUrl, token });
}

async function handleLayerSearchCommand(
  query: string,
  opts: { account?: string; format?: string; baseUrl?: string; tag?: string },
) {
  const format = parseOutputFormat(opts.format);
  try {
    const results = await listLayersInScope(
      { q: query, tag: opts.tag, limit: 25, sort: "updated" },
      { account: opts.account, baseUrl: opts.baseUrl },
    );
    if (format === "json") {
      printJson(results);
      return;
    }

    renderLayerSearchResults(results);
    if (results.length === 0) {
      const aliasHint = catalogAliasHint(query);
      if (aliasHint) {
        ui.hint(aliasHint);
      }
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleProfileSearchCommand(
  query: string,
  opts: { account?: string; format?: string; baseUrl?: string },
) {
  await handleLayerSearchCommand(query, {
    ...opts,
    tag: PROFILE_LAYER_TAG,
  });
}

async function handleLayerInstallCommand(
  selector: string | undefined,
  opts: {
    as?: string;
    org?: string;
    catalog?: string;
    version?: string;
    account?: string;
    baseUrl?: string;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<{ layerName: string; layerId: string } | undefined> {
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
      ui.danger("error: selector is required in non-interactive mode. Use: layer pull org/catalog/layer[@version]");
      return undefined;
    }

    try {
      const selected = await runInteractiveCatalogBrowser({
        message: "Select a layer to install",
        scopeLabel: formatCatalogScopeLabel(scope),
        listLayers: ({ q, limit }) =>
          listLayersInScope(
            { q, limit, sort: "updated" },
            { account: opts.account, baseUrl: opts.baseUrl },
          ),
      });
      selector = selected.selector;
      if (!opts.version && selected.version) {
        opts = { ...opts, version: selected.version };
      }
    } catch (err) {
      process.exitCode = 1;
      if (isPromptCancellationError(err)) {
        return undefined;
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  let parsed: ReturnType<typeof resolveRemoteLayerSelector>;
  try {
    parsed = resolveRemoteLayerSelector(selector, {
      org: opts.org,
      catalog: opts.catalog,
      version: opts.version,
    });
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }

  const localName = opts.as ?? parsed.layer_slug;
  const existing = getLayer(localName);
  if (existing && !opts.as) {
    process.exitCode = 1;
    ui.danger(`Layer name already exists: ${localName}. Use --as to install under a different name.`);
    return undefined;
  }

  try {
    const installed = await installLayerFromCatalog(parsed, {
      as: opts.as,
      account: opts.account,
      baseUrl: opts.baseUrl,
    });
    if (parseOutputFormat(opts.format) === "json") {
      printJson({
        layer_name: installed.layerName,
        org_slug: parsed.org_slug,
        catalog_slug: parsed.catalog_slug,
        layer_slug: parsed.layer_slug,
        version: installed.version,
      });
      return { layerName: installed.layerName, layerId: installed.layerId };
    }
    const sourceLabel = formatPublishedSelector({
      org: parsed.org_slug,
      catalog: parsed.catalog_slug,
      name: parsed.layer_slug,
    });
    ui.success(`Installed layer ${installed.layerName} from ${sourceLabel}`);
    return { layerName: installed.layerName, layerId: installed.layerId };
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

async function handleProfilePullCommand(
  selector: string,
  opts: {
    as?: string;
    org?: string;
    catalog?: string;
    version?: string;
    account?: string;
    baseUrl?: string;
    format?: string;
  },
): Promise<void> {
  const installed = await handleLayerInstallCommand(selector, opts);
  if (!installed || process.exitCode) {
    return;
  }

  const installedLayer = getLayer(installed.layerName);
  if (!installedLayer || isProfileLayer(installedLayer)) {
    return;
  }

  ui.warn(
    `Installed layer ${ui.theme.accent(installed.layerName)} is not tagged as a profile.`,
  );
}

async function handleLayerPublishCommand(
  layerName: string,
  opts: { org?: string; catalog?: string; account?: string; format?: string },
) {
  const db = getDb();
  initializeSchema(db);
  const layer = getLayer(layerName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerName}`);
    return;
  }

  try {
    const client = await resolveCloudClientForLayerCommand(opts.account);
    if (!client) {
      process.exitCode = 1;
      ui.danger("No cloud account configured. Use `auth login` to create one or pass --account.");
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

    // build layer export using exporter
    const layerExport = exportLayer(layer.id);
    const layerExportToml = formatLayerExportToml(layerExport);

    const catalogSlug = opts.catalog ?? "default";
    const resp = await client.publishLayerExport(
      { layer_name: layer.name, org_slug: orgSlug, catalog_slug: catalogSlug },
      layerExportToml,
    );
    updateLayerPublishedIdentity(layer.id, {
      org_slug: orgSlug,
      catalog_slug: catalogSlug,
      version: typeof resp.version === "string" ? resp.version : undefined,
    });
    if (parseOutputFormat(opts.format) === "json") {
      printJson(resp);
      return;
    }
    const publishedLabel = formatPublishedSelector({
      org: orgSlug,
      catalog: catalogSlug,
      name: layer.name,
    });
    ui.success(`Published layer ${layer.name} to ${publishedLabel}`);
  } catch (err) {
    process.exitCode = 1;
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Enhance error message for common cases
    if (errorMsg.includes("409")) {
      ui.danger(`Layer slug "${layer.name}" already exists in organization. Choose a different layer name or delete the existing published layer.`);
    } else {
      ui.danger(errorMsg);
    }
  }
}

function countMaterialLayerResources(layerId: string): number {
  return getLayerResources(layerId).filter(
    (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
  ).length;
}

function warnProfilePublishValidation(layer: Layer): void {
  const refs = listAttachedLayerRefs(layer.id);
  const materialCount = countMaterialLayerResources(layer.id);
  if (refs.length === 0 && materialCount === 0) {
    ui.warn(
      `Profile ${ui.theme.accent(layer.name)} has no layer references and no material resources.`,
    );
  }

  const unresolvedLocalRefs: string[] = [];
  for (const ref of refs) {
    const local = resolveLayerSelector(
      ref.version_constraint
        ? `${ref.dependency_name}@${ref.version_constraint}`
        : ref.dependency_name,
    );
    if (!local) {
      continue;
    }
    if (!local.org_slug || !local.catalog_slug) {
      unresolvedLocalRefs.push(ref.dependency_name);
    }
  }

  if (unresolvedLocalRefs.length > 0) {
    ui.warn(
      `Profile ${ui.theme.accent(layer.name)} references unpublished local layers: ${unresolvedLocalRefs.join(", ")}`,
    );
  }
}

async function handleProfilePublishCommand(
  layerName: string,
  opts: { org?: string; catalog?: string; account?: string; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const layer = getLayer(layerName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerName}`);
    return;
  }
  if (!isProfileLayer(layer)) {
    ui.warn(`Layer "${layer.name}" is not tagged as a profile.`);
  }
  warnProfilePublishValidation(layer);
  await handleLayerPublishCommand(layerName, opts);
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
  const layer = getLayer(name);
  if (!layer) {
    ui.danger(`Layer not found: ${name}`);
    return;
  }
  const allResources = getLayerResources(layer.id);
  const resources = allResources.filter(
    (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
  );
  const pluginPins = listAttachedPluginPins(layer.id);
  const pluginPinRows = pluginPins.map((pin, index) => ({
    layer_id: layer.id,
    ref: pin.ref,
    version_constraint: pin.version_constraint,
    order: index,
    embed_on_export: pin.embed_on_export,
  }));
  const dependencies = listLayerDependencies(layer.id);
  const configuredLayer = (() => {
    if (/^[0-9A-Z]{26}$/.test(name)) {
      return getLayerById(name);
    }
    const atIdx = name.lastIndexOf("@");
    if (atIdx > 0) {
      return resolveLayerSelector(name);
    }
    return resolveLayerSelector(`${layer.name}@${layer.version}`);
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
      plugin_pins: pluginPinRows,
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
      ["Plugin pins", pluginPinRows.length === 0 ? "(none pinned)" : `${pluginPinRows.length}`],
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
  if (pluginPinRows.length > 0) {
    ui.subheader("PLUGIN PINS");
    ui.table.print({
      columns: [
        { key: "ref", header: "REF", width: 28 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "constraint", header: "CONSTRAINT", width: 20 },
        { key: "sync", header: "SYNC", width: 14 },
      ],
      rows: pluginPins.map((pin) => {
        const metadata = pin.resource.metadata as PluginPinMetadata;
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

function shouldUseInteractiveLayerEdit(input: {
  noInteractive?: boolean;
  format?: string;
}): boolean {
  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

function printLayerEditJsonSnapshot(layer: Layer, rows: ReturnType<typeof buildLayerEditCandidates>): void {
  printJson({
    layer: {
      id: layer.id,
      name: layer.name,
      version: layer.version,
    },
    attachments: rows
      .filter((row) => row.checked)
      .map((row) => ({
        key: attachmentKey(row),
        type: row.type,
        id: row.id.startsWith("layer-candidate:") ? null : row.id,
        version_constraint: row.version_constraint ?? null,
      })),
  });
}

async function handleLayerEditCommand(
  name: string | undefined,
  opts: {
    type?: string;
    search?: string;
    showId?: boolean;
    all?: boolean;
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
    add?: string[];
    remove?: string[];
    apply?: string;
    version?: string;
    embed?: boolean;
    sync?: boolean;
    environment?: string;
    clearEnvironment?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const adds = opts.add ?? [];
  const removes = opts.remove ?? [];
  const environmentChange = opts.environment
    ? { kind: "set" as const, environment: opts.environment }
    : opts.clearEnvironment
      ? { kind: "clear" as const }
      : undefined;
  const scripting = adds.length > 0
    || removes.length > 0
    || Boolean(opts.apply)
    || Boolean(environmentChange);

  if (opts.environment && opts.clearEnvironment) {
    process.exitCode = 1;
    ui.danger("Cannot use --environment and --clear-environment together");
    return;
  }

  let typeFilter: ResourceType | undefined;
  if (scripting) {
    if (opts.type) {
      try {
        validateLayerAttachmentType(opts.type);
      } catch (error) {
        process.exitCode = 1;
        ui.danger(error instanceof Error ? error.message : String(error));
        return;
      }
    }
  } else if (isLayerAttachmentOnlyType(opts.type)) {
    typeFilter = undefined;
  } else {
    const resolvedType = resolveResourceListType(undefined, opts.type);
    if (resolvedType === "conflict") {
      ui.danger(`Conflicting type filters: ${opts.type}`);
      return;
    }
    if (resolvedType === "invalid") {
      ui.danger(`Invalid type. Valid: ${RESOURCE_TYPES.join(", ")}`);
      return;
    }
    typeFilter = resolvedType;
  }

  const resolvedName = scripting
    ? name
    : name ?? await resolveLayerMutationTarget({
        layerName: name,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
        message: "Which layer do you want to edit?",
      });

  if (!resolvedName) {
    process.exitCode = 1;
    ui.danger(
      scripting || listLayers().length > 0
        ? "error: missing required argument 'name'"
        : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
    );
    return;
  }

  const layer = getLayer(resolvedName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${resolvedName}`);
    return;
  }

  const candidates = buildLayerEditCandidates(layer);

  if (scripting) {
    try {
      if (environmentChange) {
        if (opts.dryRun) {
          const action = environmentChange.kind === "set"
            ? `set default environment to ${environmentChange.environment}`
            : "clear default environment";
          ui.info(`Would ${action} on ${formatLayerLabel(layer)}`);
        } else if (environmentChange.kind === "set") {
          const result = setLayerEnvironmentCommand(resolvedName, environmentChange.environment);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Set default environment on ${ui.theme.accent(formatLayerLabel(layer))}`,
            );
          }
        } else {
          const result = unsetLayerEnvironmentCommand(resolvedName);
          if (format === "json") {
            printJson(result);
          } else {
            ui.success(
              `Cleared default environment on ${ui.theme.accent(formatLayerLabel(layer))}`,
            );
          }
        }
      }

      const attachmentScripting = adds.length > 0 || removes.length > 0 || Boolean(opts.apply);
      if (!attachmentScripting) {
        return;
      }

      if (opts.apply) {
        const raw = readFileSync(opts.apply, "utf8");
        const attachments = parseLayerEditApplyFile(raw);
        const pending = buildPendingFromApplySpec(candidates, attachments);
        const result = await applyLayerEdit({
          layer,
          initial: candidates,
          pending,
          dryRun: opts.dryRun,
        });
        printLayerEditSuccess(layer, result, opts.dryRun);
        return;
      }

      const attachmentType = validateLayerAttachmentType(opts.type);
      const result = await applyLayerEditScripting({
        layer,
        adds: adds.map((selector) => ({
          selector,
          type: attachmentType,
          version: opts.version,
          embed: opts.embed,
          sync: opts.sync,
        })),
        removes: removes.map((selector) => ({
          selector,
          type: attachmentType,
        })),
        dryRun: opts.dryRun,
      });

      if (opts.dryRun) {
        printLayerEditSuccess(layer, result, true);
        return;
      }

      for (const message of result.messages) {
        ui.success(ui.theme.accent(message));
      }
      return;
    } catch (error) {
      if (error instanceof LayerAttachmentHintError) {
        process.exitCode = 1;
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  if (format === "json" && !shouldUseInteractiveLayerEdit(opts)) {
    printLayerEditJsonSnapshot(layer, candidates);
    return;
  }

  if (!shouldUseInteractiveLayerEdit(opts)) {
    process.exitCode = 1;
    ui.danger(
      `layer edit requires an interactive terminal, or use \`${formatCommand("layer edit <name> --add <selector> --type <type>")}\`, \`--remove\`, \`--apply <file>\`, \`--environment <name>\`, or \`--clear-environment\` for scripting.`,
    );
    return;
  }

  try {
    const pending = await runLayerEditWizard({
      layer,
      typeFilter,
      search: opts.search,
      showId: opts.showId,
      showAll: opts.all,
    });
    if (!pending) {
      process.exitCode = 1;
      return;
    }

    const result = await applyLayerEdit({
      layer,
      initial: candidates,
      pending,
      dryRun: opts.dryRun,
    });
    printLayerEditSuccess(layer, result, opts.dryRun);
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function printLayerEditSuccess(
  layer: Layer,
  result: { added: string[]; removed: string[] },
  dryRun?: boolean,
): void {
  const label = formatLayerLabel(layer);
  const summary = `+${result.added.length} added, −${result.removed.length} removed`;
  if (dryRun) {
    ui.success(`Dry run for layer ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary} (no changes written)`);
    return;
  }
  ui.success(`Updated layer ${ui.theme.accent(label)} ${ui.icons.bullet} ${summary}`);
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
      const configuredLayer = resolveLayerSelector(selector);
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
    (row) => row.layer_id,
  );
  if (configuredLayerIds.length === 0) {
    throw new Error(
      `Project ${projectRoot} has no applied configured layers; pass --layers explicitly`,
    );
  }
  return configuredLayerIds;
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
          message: `No project record. Run ${formatCommand("layer apply")} first.`,
        });
        return;
      }
      ui.warn(`No project record found. Run \`${formatCommand("layer apply")}\` first.`);
      return;
    }

    const report = detectProjectDriftFromLatest(projectRoot, project.id);
    if (!report) {
      return;
    }
    if (format === "json") {
      printJson(report);
      if (report.has_drift) {
        process.exitCode = 1;
      }
      return;
    }
    if (!report.snapshot_id) {
      ui.dim("No snapshots found. Drift detection requires a prior apply or mirror.");
      return;
    }
    if (!report.has_drift) {
      ui.success("No drift detected since last snapshot.");
      return;
    }
    ui.danger(
      `Drift detected: ${report.changes.length} change(s) since snapshot ${report.snapshot_id}`,
    );
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
    } else {
      ui.success(
        `Set active environment ${ui.theme.accent(payload.environment_name)} for ${projectRoot}`,
      );
    }

    if (opts.reapply) {
      const project = getProjectByLocalPath(projectRoot);
      if (!project) {
        ui.warn(`Reapply skipped: no tracked project at ${projectRoot}.`);
        return;
      }
      const configuredLayerIds = getProjectConfiguredLayers(project.id).map(
        (row) => row.layer_id,
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

function printQuickStartGuide(): void {
  console.log("");
  ui.subheader("NEXT STEPS");
  console.log("");
  console.log(
    `  ${formatCommand(`layer search ${CANONICAL_CATALOG_SEARCH_HINT}`)}`,
  );
  console.log(
    `  ${formatCommand(`layer apply ${CANONICAL_CATALOG_BASELINE}`)}`,
  );
  console.log(`  ${formatCommand("help")}`);
  ui.dim(`Enable tab completion: ${formatCommand("completion zsh >> ~/.zshrc")}`);
}

function handleHelpCommand(opts: { format?: string }): void {
  const format = parseOutputFormat(opts.format);
  if (format === "json") {
    printJson(buildHelpCommandPayload());
    return;
  }
  printHelpCommand();
}

function handleScenarioGuideCommand(scenarioInput: string, opts: { format?: string }): void {
  const format = parseOutputFormat(opts.format);
  try {
    const scenario = loadScenarioGuide(parseScenarioId(scenarioInput));
    if (format === "json") {
      printJson(scenario);
      return;
    }

    console.log("");
    ui.subheader(`SCENARIO ${scenario.id}: ${scenario.title.toUpperCase()}`);
    if (scenario.frequency || scenario.status) {
      console.log("");
      ui.dim(
        [scenario.frequency, scenario.status].filter(Boolean).join(" · "),
      );
    }
    if (scenario.summaryLines.length > 0) {
      console.log("");
      for (const line of scenario.summaryLines) {
        console.log(`  ${line}`);
      }
    }
    if (scenario.commands.length > 0) {
      console.log("");
      ui.subheader("TYPICAL COMMANDS");
      console.log("");
      for (const command of scenario.commands) {
        console.log(`  ${formatCommand(command)}`);
      }
    }
    console.log("");
    ui.dim(`Full doc: docs/scenarios/details/${scenario.filename}`);
    ui.dim(`All scenarios: ${GUIDE_SCENARIOS_URL}`);
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err), {
      hints: [`hd help scenario 11`, `See ${GUIDE_SCENARIOS_URL}`],
    });
  }
}

async function resolveSkillPackageCheckout(
  source: string,
  harnessdeckDir: string,
): Promise<{ checkoutRoot: string; namespace: string }> {
  const resolved = resolveRemoteSource(source);
  if (resolved.kind === "git") {
    const cacheDir = sourceCacheDir(
      harnessdeckDir,
      resolved.owner,
      resolved.repo,
    );
    const refresh = refreshGitSource({
      url: resolved.url,
      targetDir: cacheDir,
    });
    if (!refresh.ok) {
      throw new Error(refresh.message);
    }
    return { checkoutRoot: cacheDir, namespace: resolved.label };
  }

  return { checkoutRoot: resolved.path, namespace: resolved.label };
}

function parseCommaSeparatedList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function resolveAddScope(opts: {
  global?: boolean;
  project?: boolean | string;
}): { scope: "global" | "project"; projectRoot?: string } | undefined {
  if (opts.global && opts.project !== undefined) {
    throw new Error("Pass only one of --global or --project.");
  }
  if (opts.global) {
    return { scope: "global" };
  }
  if (opts.project !== undefined) {
    return {
      scope: "project",
      projectRoot: typeof opts.project === "string" ? opts.project : ".",
    };
  }
  return undefined;
}

async function handleAddCommand(
  source: string,
  opts: {
    skill?: string;
    all?: boolean;
    harness?: string;
    global?: boolean;
    project?: boolean | string;
    method?: string;
    layer?: string;
    createLayer?: string;
    list?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    format?: string;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnessdeckDir = getHarnessdeckDir();
  const homeRoot = resolveHomeRoot();

  if (opts.layer && opts.createLayer) {
    throw new Error("Pass only one of --layer or --create-layer.");
  }

  const method = opts.method === "copy" ? "copy" : opts.method === "symlink" || !opts.method
    ? "symlink"
  : (() => {
      throw new Error(`Invalid --method value: ${opts.method}. Use symlink or copy.`);
    })();

  const { checkoutRoot, namespace } = await resolveSkillPackageCheckout(
    source,
    harnessdeckDir,
  );
  const classification = classifyRepo(checkoutRoot);
  if (classification.primary !== "skill-package") {
    throw new Error(
      `Source is not a skill package (detected: ${classification.primary}). Use a repo with skills/ or .agents/skills/ containing SKILL.md files.`,
    );
  }

  const discovered = discoverSkillPackage(checkoutRoot);
  if (discovered.length === 0) {
    throw new Error(`No skills found in skill package: ${checkoutRoot}`);
  }

  if (opts.list) {
    const payload = {
      source,
      namespace,
      primary: classification.primary,
      skills: discovered,
    };
    if (format === "json") {
      printJson(payload);
      return;
    }

    ui.subheader("DISCOVERED SKILLS");
    console.log("");
    for (const skill of discovered) {
      const description = skill.description.trim();
      console.log(
        `  ${ui.theme.accent(skill.name)} ${ui.theme.muted(`[${skill.category}]`)}`,
      );
      if (description) {
        ui.dim(`    ${description}`);
      }
    }
    return;
  }

  const db = getDb();
  initializeSchema(db);

  const scopeFromFlags = resolveAddScope({
    global: opts.global,
    project: opts.project,
  });
  const skillNames = parseCommaSeparatedList(opts.skill);
  const harnesses = parseCommaSeparatedList(opts.harness);
  if (harnesses) {
    assertSupportedHarnessTargets(harnesses);
  }

  const shouldPrompt = shouldUseWizard({
    noInteractive: opts.yes,
    format,
    missingRequiredArgs:
      !scopeFromFlags
      || (!opts.all && (!skillNames || skillNames.length === 0)),
  });

  const wizard = await runAddPackageWizard({
    discovered,
    skillNames,
    all: opts.all,
    scope: scopeFromFlags?.scope,
    projectRoot: scopeFromFlags?.projectRoot,
    method,
    harnesses,
    createLayer: opts.createLayer,
    layer: opts.layer,
    sourceLabel: namespace,
    shouldPrompt,
  });

  if (!wizard.confirmed) {
    ui.warn("Installation cancelled.");
    return;
  }

  const result = await addSkillPackage({
    source,
    skillNames: wizard.skillNames,
    all: wizard.all,
    scope: wizard.scope,
    projectRoot: wizard.projectRoot,
    method: wizard.method,
    harnesses: wizard.harnesses,
    homeRoot,
    harnessdeckDir,
    createLayer: wizard.createLayer,
    layer: wizard.layer,
    dryRun: opts.dryRun,
  });

  const payload = {
    source,
    namespace: result.namespace,
    discovered: discovered.map((skill) => skill.name),
    imported: result.importedSkills,
    installed: result.installedSkills,
    snapshot_id: result.snapshotId,
    ...(result.layer ? { layer: result.layer } : {}),
  };

  if (format === "json") {
    printJson(payload);
    return;
  }

  if (opts.dryRun) {
    ui.success(
      `Dry run ${ui.icons.hint} would install ${result.installedSkills.join(", ")} from ${result.namespace}`,
    );
    return;
  }

  ui.success(
    `Installed ${formatCount(result.installedSkills.length, "skill")} from ${result.namespace}`,
  );
  console.log("");
  ui.kvBlock([
    { key: "Skills", value: result.installedSkills.join(", ") },
    { key: "Scope", value: wizard.scope },
    ...(wizard.scope === "project"
      ? [{ key: "Project", value: resolve(wizard.projectRoot ?? ".") }]
      : []),
    { key: "Snapshot", value: result.snapshotId },
  ]);
}

async function handleInitCommand(opts: {
  format?: string;
  main?: string;
  aliases?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  defaultProfile?: boolean;
} = {}): Promise<void> {
  const dbPath = getDbPath();
  const hadExistingStore = existsSync(dbPath);
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  if (format === "human" && hadExistingStore) {
    const preference = getHarnessPreference();
    ui.warn(
      "~/.harnessdeck already exists. Harness preferences stay unchanged unless you pass --main or --aliases.",
    );
    if (preference) {
      ui.dim(
        `Current defaults: main=${preference.main_harness}, aliases=${preference.alias_harnesses.join(", ") || "(none)"}`,
      );
    }
    console.log("");
  }
  const homeDefaults = await scanAndPersistHomeDefaults();
  if (opts.defaultProfile !== false) {
    const homeProfileResources = homeDefaults.resolved.filter(
      (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
    );
    let defaultProfileLayer = listLayers().find(
      (layer) => layer.name === "default" && isProfileLayer(layer),
    );
    const shouldSeedDefaultProfile =
      !defaultProfileLayer
      || getLayerResources(defaultProfileLayer.id).filter(
        (resource) => resource.type !== "plugin_pin" && resource.type !== "layer",
      ).length === 0;

    if (!defaultProfileLayer) {
      defaultProfileLayer = createLayer({
        name: "default",
        version: "1.0.0",
        description: "Bootstrap profile from init",
        tags: [PROFILE_LAYER_TAG],
      });
    }

    if (shouldSeedDefaultProfile) {
      for (const resource of homeProfileResources) {
        addResourceToLayer(defaultProfileLayer.id, resource.id);
      }
    }

    setActiveProfileName("default");
  }
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

  printQuickStartGuide();

  const canPromptCatalog =
    format === "human"
    && !opts.noInteractive
    && !process.argv.includes("--no-interactive")
    && Boolean(process.stdin.isTTY && process.stdout.isTTY)
    && !["1", "true", "yes"].includes(process.env.CI?.trim().toLowerCase() ?? "")
    && (opts.interactive === true || useWizard)
    && listLayers().length === 0;

  if (canPromptCatalog) {
    try {
      await maybePromptInitCatalogInstall({
        interactive: true,
        noInteractive: opts.noInteractive,
        format,
      });
    } catch (err) {
      if (!isPromptCancellationError(err)) {
        throw err;
      }
    }
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
    reportNoGitOrigin(`${formatCommand("harness project set --project . --main codex")}`);
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

async function handleLayerDoctorCommand(
  name: string | undefined,
  opts: {
    check?: string[];
    format?: string;
    listChecks?: boolean;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
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

    const resolvedName = name ?? await resolveLayerMutationTarget({
      layerName: name,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which layer do you want to diagnose?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      ui.danger(
        listLayers().length > 0
          ? "error: missing required argument 'name'"
          : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
      );
      return;
    }

    const report = runLayerDoctor({
      nameOrId: resolvedName,
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
    harness?: string;
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
      platform: opts.harness,
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
          platform: opts.harness,
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
          platform: opts.harness,
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
      platform: opts.harness,
    });

    ui.success(
      `Created layer ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "resource")}`,
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
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

async function handleMigrateExportCommand(
  file: string | undefined,
  opts: {
    file?: string;
    workspace?: boolean;
    layer?: string;
    resource?: string;
    includePlugins?: boolean;
    embedPlugins?: boolean;
    format?: string;
    noInteractive?: boolean;
    interactive?: boolean;
  },
): Promise<void> {
  const db = getDb();
  initializeSchema(db, { allowLegacyRead: true });
  const format = parseOutputFormat(opts.format);

  let exportOpts = {
    ...opts,
    file: opts.file ?? file,
  };

  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    missingRequiredArgs:
      !exportOpts.file
      && !exportOpts.layer
      && !exportOpts.resource
      && !exportOpts.workspace,
  });

  if (useWizard) {
    const wizard = await runMigrateExportWizard();
    exportOpts = {
      ...exportOpts,
      file: wizard.outputPath,
      workspace: wizard.scope === "workspace" ? true : undefined,
      layer: wizard.layer,
      resource: wizard.resource,
      includePlugins: wizard.embedPlugins,
    };
  }

  try {
    const resolved = resolveExportScope(exportOpts);
    const result = exportScopedMigration(resolved, exportOpts);
    if (format === "json") {
      if (result.scope === "workspace") {
        printJson({ ...result.manifest, output: result.output, scope: result.scope });
        return;
      }
      printJson(result);
      return;
    }
    printMigrateExportHuman(result);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function handleMigrateImportCommand(
  file: string | undefined,
  opts: {
    workspace?: boolean;
    layer?: boolean;
    resource?: boolean;
    format?: string;
    noInteractive?: boolean;
    interactive?: boolean;
  } = {},
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  let importFile = file;
  let scopeOverride: ReturnType<typeof resolveImportScope> | undefined;

  const useWizard = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    missingRequiredArgs: !importFile,
  });

  if (useWizard) {
    const wizard = await runMigrateImportWizard();
    importFile = wizard.file;
    scopeOverride = wizard.scope;
  }

  if (!importFile) {
    ui.danger("Import file path is required.");
    process.exitCode = 1;
    return;
  }

  try {
    const scope = scopeOverride ?? resolveImportScope({ ...opts, file: importFile });
    const result = importScopedMigration(scope, importFile);
    if (format === "json") {
      printJson(result);
      return;
    }
    printMigrateImportHuman(result);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
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
    reportNoGitOrigin(`${formatCommand("harness project status --project .")}`);
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

// ── help ────────────────────────────────────────────────────────────────

const helpCommand = program
  .command("help")
  .description("Core concepts and scenario playbooks")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    handleHelpCommand(opts);
  });

helpCommand
  .command("scenario")
  .argument("<id>", "Scenario number from docs/scenarios/scenarios.md")
  .description("Show a numbered scenario playbook from the docs")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((id: string, opts: { format?: string }) => {
    handleScenarioGuideCommand(id, opts);
  });

program
  .command("__complete")
  .argument("<shell>", "bash | zsh | fish")
  .argument("[line...]", "Partial command line")
  .description(false as unknown as string)
  .action(async (shell: string, line: string[]) => {
    await runCompleteCommand(shell, line, program);
  });

program
  .command("completion")
  .argument("<shell>", "Target shell: bash, zsh, or fish (must match your interactive shell)")
  .description("Print shell completion script to stdout (redirect into ~/.bashrc, ~/.zshrc, or fish completions)")
  .action((shell: string) => {
    try {
      process.stdout.write(renderShellCompletion(shell, program));
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("init")
  .description("Initialize the harnessdeck database and config directory")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--main <slug>", "Default main harness slug")
  .option("--aliases <slugs>", "Comma-separated alias harness slugs")
  .option("--no-default-profile", "Skip creating and activating the default profile layer")
  .option(
    "--interactive",
    "Prompt for harness selection instead of relying on explicit flags",
  )
  .action(async (opts: {
    format?: string;
    main?: string;
    aliases?: string;
    interactive?: boolean;
    defaultProfile?: boolean;
  }) => {
    await handleInitCommand(opts);
  });

program
  .command("add")
  .argument("<source>", "GitHub owner/repo, Git URL, or local path")
  .option("--skill <names>", "Skills to install (comma-separated)")
  .option("--all", "Install all discovered skills")
  .option("--harness <slugs>", "Target harnesses")
  .option("--global", "Install to user home")
  .option("--project [path]", "Install to project directory")
  .option("--method <mode>", "symlink or copy", "symlink")
  .option("--layer <name>", "Combine into existing layer")
  .option("--create-layer <name>", "Create layer and attach skills")
  .option("--list", "List discovered skills only")
  .option("--dry-run", "Show plan without writing")
  .option("-y, --yes", "Skip prompts")
  .option("--format <mode>", "human or json", "human")
  .description("Add skills from a remote or local source")
  .action(async (source: string, opts: {
    skill?: string;
    all?: boolean;
    harness?: string;
    global?: boolean;
    project?: boolean | string;
    method?: string;
    layer?: string;
    createLayer?: string;
    list?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    format?: string;
  }) => {
    try {
      await handleAddCommand(source, opts);
    } catch (err) {
      process.exitCode = 1;
      if (isPromptCancellationError(err)) {
        return;
      }
      ui.danger(err instanceof Error ? err.message : String(err));
    }
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
      const layer = createLayer({
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
    const layers = listLayers();
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
        listLayers().length > 0
          ? "error: missing required argument 'name'"
          : `No layers found. Create one with \`${formatCommand("layer create <name>")}\` first.`,
      );
      return;
    }
    handleLayerShowCommand(resolvedName, opts);
  });

layerCmd
  .command("edit")
  .argument("[name]", "Layer name or ID")
  .option("-t, --type <type>", `Attachment or filter type (${LAYER_ATTACHMENT_TYPES.join(", ")})`)
  .option("-s, --search <query>", "Pre-fill search filter (interactive mode)")
  .option("--show-id", "Show IDs in tables")
  .option("--all", "Show all resources per type (default: first 10 per type)")
  .option("--add <selector>", "Add attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--remove <selector>", "Remove attachment (repeatable; scripting mode)", collectRepeatedOption, [])
  .option("--apply <file>", "Apply membership from JSON file (scripting mode)")
  .option("--version <constraint>", "Version constraint for plugin or layer attachments")
  .option("--embed", "Mark plugin pin as embed-on-export when adding")
  .option("--sync", "Sync plugin resource immediately after add")
  .option("--environment <name>", "Set default environment for layer apply cascade")
  .option("--clear-environment", "Clear default environment from layer")
  .option("--dry-run", "Preview changes without writing")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Edit layer composition and default environment (interactive or scripting)")
  .action(async (name: string | undefined, opts: {
    type?: string;
    search?: string;
    showId?: boolean;
    all?: boolean;
    add?: string[];
    remove?: string[];
    apply?: string;
    version?: string;
    embed?: boolean;
    sync?: boolean;
    environment?: string;
    clearEnvironment?: boolean;
    dryRun?: boolean;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  }) => {
    try {
      await handleLayerEditCommand(name, opts);
    } catch (error) {
      process.exitCode = 1;
      if (error instanceof LayerAttachmentHintError) {
        ui.danger(error.message, { hints: error.hints });
        return;
      }
      ui.danger(error instanceof Error ? error.message : String(error));
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
        const layer = getLayer(resolvedName);
        if (!layer) {
          process.exitCode = 1;
          ui.danger(`Layer not found: ${resolvedName}`);
          return;
        }
        if (!deleteLayer(layer.id)) {
          throw new Error(`Failed to delete layer ${formatLayerLabel(layer)}`);
        }
        ui.success(`Deleted layer ${ui.theme.accent(formatLayerLabel(layer))}`);
      }
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

addApplyCommandOptions(
  layerCmd
    .command("apply")
    .argument(
      "[layers...]",
      "Layer name(s), layer export path, or URL (multiple layers are merged in order)",
    )
    .description(
      "Apply one or more layers (or a layer export URL) to a project, serializing for each harness",
    ),
).action(async (layers: string[], opts: ApplyCommandOpts) => {
  await handleApplyCommand(layers as [string, ...string[]] | [], opts);
});

layerCmd
  .command("search")
  .argument("<query>", "Search query for layers on the cloud catalog")
  .option("--account <name>", "Cloud account to use")
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
  .argument("<target>", "org <slug> or layer <org/catalog/layer>")
  .argument("[value]", "Organization slug or org/catalog/layer selector")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .description("Connect an org or individual public layer to the local catalog scope")
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
      if (target === "layer") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/layer' for layer connect");
          return;
        }
        await handleLayerCatalogConnectLayerCommand(value, opts);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'layer'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCatalogCmd
  .command("disconnect")
  .argument("<target>", "org <slug> or layer <org/catalog/layer>")
  .argument("[value]", "Organization slug or org/catalog/layer selector")
  .description("Disconnect a connected org or layer from the local catalog scope")
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
      if (target === "layer") {
        if (!value) {
          process.exitCode = 1;
          ui.danger("error: missing required argument 'org/catalog/layer' for layer disconnect");
          return;
        }
        await handleLayerCatalogDisconnectLayerCommand(value);
        return;
      }
      process.exitCode = 1;
      ui.danger("error: target must be 'org' or 'layer'");
    } catch (error) {
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

layerCmd
  .command("pull")
  .argument("[selector]", "Remote selector: org/catalog/layer[@version], org/layer[@version], or layer[@version] with --org")
  .option("--as <name>", "Install under a different local layer name")
  .option("--org <slug>", "Organization slug (when selector omits org)")
  .option("--catalog <slug>", "Catalog slug (default: default)")
  .option("--version <constraint>", "Version constraint (when selector omits version)")
  .option("--account <name>", "Cloud account to use")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Pull a layer from the remote catalog into the local DB")
  .action(async (selector, opts) => {
    await handleLayerInstallCommand(selector, opts);
  });

layerCmd
  .command("publish")
  .argument("<layer>", "Local layer name to publish")
  .option("--org <slug>", "Organization slug to publish under")
  .option("--catalog <slug>", "Catalog slug to publish under (default: default)")
  .option("--account <name>", "Cloud account to use")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a local layer to the cloud catalog")
  .action(handleLayerPublishCommand);

layerCmd
  .command("diff")
  .argument("<left>", "Layer name or layer export file")
  .argument("<right>", "Layer name or layer export file")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Diff two layers or a layer and a layer export file")
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
  .option("-h, --harness <slug>", "Scan only a specific harness")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Scan current folder and create a layer from its resources")
  .action(handleLayerFromProjectCommand);

// ── profile ──────────────────────────────────────────────────────────────

const profileCmd = configureCommandGroup(
  program
    .command("profile")
    .alias("p")
    .description("Manage profile layers and global profile switching"),
);

profileCmd
  .command("list")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const profiles = listProfileLayersCommand();
    const active = getActiveProfilePayload().active_profile;
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        profiles: profiles.map((profile) => ({
          ...profile,
          active: active === profile.name,
        })),
      });
      return;
    }
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 24 },
        { key: "version", header: "VERSION", width: 12 },
        { key: "active", header: "ACTIVE", width: 8 },
        { key: "description", header: "DESCRIPTION", width: 50 },
      ],
      rows: profiles.map((profile) => ({
        name: profile.name,
        version: profile.version,
        active: active === profile.name ? "yes" : "",
        description: profile.description || "—",
      })),
      empty: "No profile layers found.",
    });
  });

profileCmd
  .command("show")
  .argument("<name>", "Profile layer name or selector")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const payload = showProfileCommand(name);
    if (format === "json") {
      printJson(payload);
      return;
    }
    console.log(`${ui.theme.muted("Profile:")} ${ui.theme.accent(payload.profile.name)}`);
    console.log(`${ui.theme.muted("Version:")} ${payload.profile.version}`);
    console.log(`${ui.theme.muted("Active:")} ${payload.active ? "yes" : "no"}`);
    console.log("");
    ui.table.print({
      columns: [
        { key: "dependency_name", header: "DEPENDENCY", width: 28 },
        { key: "version_constraint", header: "VERSION", width: 16 },
      ],
      rows: payload.dependencies,
      empty: "No attached layer dependencies.",
    });
  });

profileCmd
  .command("active")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = getActiveProfilePayload();
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(payload);
      return;
    }
    if (!payload.active_profile) {
      ui.info("No active profile set.");
      return;
    }
    ui.success(`Active profile: ${ui.theme.accent(payload.active_profile)}`);
  });

profileCmd
  .command("use")
  .argument("<name>", "Profile layer name or selector")
  .option("--dry-run", "Show what would be written")
  .option(
    "--harness <slugs>",
    "Comma-separated harness slugs (defaults to global harness preference)",
  )
  .option(
    "--on-conflict <policy>",
    "When generated files already exist: replace, skip, or prompt",
  )
  .option("--account <name>", "Cloud account name for dependency pulls")
  .option("--base-url <url>", "Cloud base URL for dependency pulls")
  .option("--no-pull", "Do not auto-pull missing published layer dependencies")
  .option("--format <mode>", "Output format: human or json", "human")
  .action(async (name: string, opts: {
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflict,
    });
    try {
      const payload = await useProfileCommand(name, {
        dryRun: opts.dryRun,
        harness: opts.harness,
        pull: opts.pull,
        account: opts.account,
        baseUrl: opts.baseUrl,
        conflictPolicy,
        ...(conflictPolicy === "prompt"
          ? { conflictResolver: promptMaterializationConflict }
          : {}),
      });
      if (format === "json") {
        printJson(payload);
        return;
      }
      if (payload.cancelled) {
        process.exitCode = 1;
        ui.warn("Profile apply cancelled.");
        return;
      }
      const dryPrefix = payload.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Applied profile ${ui.theme.accent(payload.profile_name)} to ${payload.harnesses.join(", ") || "(none)"}`,
      );
      if (payload.default_environment_name) {
        ui.info(`Default environment: ${payload.default_environment_name}`);
      }
      if ((payload.pulled_layers?.length ?? 0) > 0) {
        ui.info(
          `Pulled ${payload.pulled_layers?.length ?? 0} missing layer dependencies:`,
        );
        for (const pulled of payload.pulled_layers ?? []) {
          console.log(`  - ${pulled.layer_name} (${pulled.source})`);
        }
      }
      ui.kvBlock([
        { key: "Files", value: `${payload.files.length}` },
        { key: "Written", value: `${payload.written_files.length}` },
        { key: "Skipped", value: `${payload.skipped_files.length}` },
        ...(payload.snapshot_id ? [{ key: "Snapshot", value: payload.snapshot_id }] : []),
      ]);
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

profileCmd
  .command("create")
  .argument("<name>", "Profile layer name")
  .option("-d, --description <text>", "Profile description")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((name: string, opts: { description?: string; format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const layer = createProfileCommand({
      name,
      description: opts.description,
    });
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(layer);
      return;
    }
    ui.success(`Created profile ${ui.theme.accent(layer.name)}`);
  });

profileCmd
  .command("tag")
  .argument("<layer>", "Layer selector")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((layer: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = tagProfileCommand(layer);
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(payload);
      return;
    }
    ui.success(`Tagged layer ${ui.theme.accent(layer)} as profile`);
  });

profileCmd
  .command("untag")
  .argument("<layer>", "Layer selector")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((layer: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const payload = untagProfileCommand(layer);
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson(payload);
      return;
    }
    ui.success(`Removed profile tag from ${ui.theme.accent(layer)}`);
  });

profileCmd
  .command("search")
  .argument("<query>", "Search query")
  .option("--account <name>", "Cloud account name")
  .option("--base-url <url>", "Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Search catalog profile layers (tag=profile)")
  .action(async (query: string, opts: {
    account?: string;
    baseUrl?: string;
    format?: string;
  }) => {
    await handleProfileSearchCommand(query, opts);
  });

profileCmd
  .command("pull")
  .argument("<selector>", "Catalog profile selector")
  .option("--as <name>", "Install as local layer name")
  .option("--org <slug>", "Organization slug helper for short selectors")
  .option("--catalog <slug>", "Catalog slug helper for short selectors")
  .option("--version <version>", "Layer version helper for short selectors")
  .option("--account <name>", "Cloud account name")
  .option("--base-url <url>", "Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Pull a profile layer from catalog")
  .action(async (selector: string, opts: {
    as?: string;
    org?: string;
    catalog?: string;
    version?: string;
    account?: string;
    baseUrl?: string;
    format?: string;
  }) => {
    await handleProfilePullCommand(selector, opts);
  });

profileCmd
  .command("publish")
  .argument("<name>", "Profile layer name")
  .option("--org <slug>", "Organization slug")
  .option("--catalog <slug>", "Catalog slug")
  .option("--account <name>", "Cloud account name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a profile layer with validation warnings")
  .action(async (name: string, opts: {
    org?: string;
    catalog?: string;
    account?: string;
    format?: string;
  }) => {
    await handleProfilePublishCommand(name, opts);
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
        (row) => row.layer_id,
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
  .argument("<file>", "Environment TOML file")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((file: string, opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const raw = readFileSync(resolve(file), "utf-8");
    const result = importEnvironmentToml(raw);
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
    const payload = exportEnvironmentToml(name);
    if (file) {
      const outPath = resolve(file);
      writeFileSync(outPath, payload.toml, "utf-8");
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
    console.log(payload.toml);
  });

// ── migrate ─────────────────────────────────────────────────────────────

const migrateCmd = configureCommandGroup(
  program
    .command("migrate")
    .alias("m")
    .description("Export or import workspace, layers, or resources for offline sharing"),
);

migrateCmd
  .command("export")
  .argument("[file]", "Output path (.tar.gz, .json, or .harnessdeck.toml)")
  .option("--workspace", "Export full workspace archive")
  .option("--layer <name>", "Export layer(s); comma-separated names or IDs")
  .option("--resource <selector>", "Export one resource (type:name or type:name@namespace)")
  .option("-o, --file <path>", "Output path (overrides positional)")
  .option("--include-plugins", "Embed plugin trees (workspace and layer scope)")
  .option("--embed-plugins", "Alias for --include-plugins")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Export workspace, layer, or resource for offline sharing")
  .action(handleMigrateExportCommand);

migrateCmd
  .command("import")
  .argument("[file]", "Archive or TOML export file")
  .option("--workspace", "Force workspace archive import")
  .option("--layer", "Force layer bundle import")
  .option("--resource", "Force resource document import")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Import workspace, layer, or resource from file")
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
  .argument("[resource]", "Resource name or ID")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .option("--all-fields", "Show all resource metadata fields")
  .option("--interactive", "Prompt instead of relying on explicit flags")
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
      prompt: async () => {
        const choices = toResourceChoices();
        if (choices.length === 0) {
          return undefined;
        }
        return promptForSearchableChoice({
          message: "Which resource do you want to show?",
          choices,
        });
      },
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

// ── project-local verbs ─────────────────────────────────────────────────

program
  .command("scan")
  .argument("[path]", "Project directory or plugin source to scan", ".")
  .option("-h, --harness <slugs>", "Harness slug(s): scan filter, or install targets with --global")
  .option("--dry-run", "Show what would be imported without writing to DB")
  .option("--global", "Install imported plugin sources into global harness locations")
  .option("--overwrite", "Overwrite library resources when scan content differs")
  .option("--skip-existing", "Keep existing library resources when scan content differs")
  .option("--namespace <name>", "Namespace for imported project resources")
  .description(
    "Scan a project directory or plugin source and import configurations into the database",
  )
  .action(handleScanCommand);

program
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

program
  .command("history")
  .argument("[path]", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show snapshot IDs in human-readable tables")
  .description("List configuration snapshots for a project")
  .action(handleHistoryCommand);

program
  .command("revert")
  .argument("[snapshot-id]", "Snapshot ID to revert to")
  .description("Revert a project to a previous configuration snapshot")
  .action(handleRevertCommand);

program
  .command("status")
  .argument("[path]", "Project directory", ".")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--check", "Exit with code 1 when drift exists since the last snapshot")
  .description("Show current project status and drift summary")
  .action(async (path: string, opts: { format?: string; check?: boolean }) => {
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

async function handleCloudLoginCommand(accountName: string | undefined, opts: { baseUrl?: string } = {}): Promise<void> {
  const name = accountName ?? "default";
  const baseUrl = resolveCloudBaseUrl(opts.baseUrl);
  try {
    const device = await requestDeviceCode(baseUrl);
    console.log(`Visit: ${deviceVerificationUri(baseUrl)}`);
    console.log(`Code:  ${device.user_code}`);
    const token = await pollDeviceToken(baseUrl, device.device_code, { interval: 0.1, maxPolls: 300 });
    const now = Math.floor(Date.now() / 1000);
    const account = {
      cloudBaseUrl: baseUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: token.expires_in ? now + token.expires_in : undefined,
      refreshTokenExpiresAt: undefined,
      orgId: token.orgId,
      orgSlug: token.orgSlug,
      scopes: token.scopes ?? [],
    };
    await saveCloudAccount(name, account);
    await setDefaultCloudAccount(name);
    ui.success(`Saved cloud account: ${name}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudWhoamiCommand(opts: { account?: string; format?: string } = {}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { account } = await getCloudAccount(opts.account);
  if (!account || !account.accessToken) {
    if (format === "json") {
      printJson({});
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: account.cloudBaseUrl,
      token: {
        access_token: account.accessToken as string,
        refresh_token: account.refreshToken as string | undefined,
        expires_at: typeof account.accessTokenExpiresAt === "number"
          ? (account.accessTokenExpiresAt as number)
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

async function handleCloudOrgsCommand(opts: { account?: string; switch?: string; format?: string } = {}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { accountName, account } = await getCloudAccount(opts.account);
  if (!account || !account.accessToken) {
    if (format === "json") {
      printJson([]);
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: account.cloudBaseUrl,
      token: {
        access_token: account.accessToken as string,
        refresh_token: account.refreshToken as string | undefined,
        expires_at: typeof account.accessTokenExpiresAt === "number"
          ? (account.accessTokenExpiresAt as number)
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
      if (accountName) {
      await updateCloudAccount(accountName, { orgId: String((target as Record<string, unknown>)['id']), orgSlug: String((target as Record<string, unknown>)['slug']) });
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

async function handleCloudLogoutCommand(opts: { account?: string } = {}): Promise<void> {
  const { accountName, account } = await getCloudAccount(opts.account);
  if (!accountName) {
    ui.warn("No cloud account configured.");
    return;
  }
  try {
    if (account?.refreshToken) {
      try {
        const client = createCloudClient({
          baseUrl: account.cloudBaseUrl,
          token: {
            access_token: account.accessToken as string || "",
            refresh_token: account.refreshToken as string,
            expires_at: typeof account.accessTokenExpiresAt === "number"
              ? (account.accessTokenExpiresAt as number)
              : undefined,
          },
        });
        await client.revokeRefreshToken();
      } catch (_) {
        // ignore revoke errors
      }
    }
    await removeCloudAccount(accountName);
    ui.success(`Logged out: ${accountName}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

// ── auth ────────────────────────────────────────────────────────────────

const authCmd = configureCommandGroup(
  program
    .command("auth")
    .alias("a")
    .description("Authenticate with HarnessDeck Cloud and manage cloud accounts"),
);

authCmd
  .command("login [account]")
  .option("--base-url <url>", "Cloud base URL")
  .description("Log into HarnessDeck Cloud via device authentication")
  .action(async (account: string | undefined, opts: { baseUrl?: string }) => {
    await handleCloudLoginCommand(account, opts);
  });

authCmd
  .command("status")
  .option("--account <name>", "Account name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show authenticated user and account context")
  .action(async (opts: { account?: string; format?: string }) => {
    await handleCloudWhoamiCommand(opts);
  });

authCmd
  .command("orgs")
  .option("--account <name>", "Account name")
  .option("--switch <org_slug>", "Switch to the given organization slug")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List organizations and optionally switch")
  .action(async (opts: { account?: string; switch?: string; format?: string }) => {
    await handleCloudOrgsCommand(opts);
  });

authCmd
  .command("logout")
  .option("--account <name>", "Account name")
  .description("Log out and remove local cloud account")
  .action(async (opts: { account?: string }) => {
    await handleCloudLogoutCommand(opts);
  });

function knownTopLevelCommandTokens(): Set<string> {
  const reserved = new Set<string>();
  for (const command of program.commands) {
    reserved.add(command.name());
    for (const alias of command.aliases()) {
      reserved.add(alias);
    }
  }
  return reserved;
}

function rewriteProfileShorthandArgv(argv: string[]): string[] {
  const candidate = argv[2];
  if (!candidate || candidate.startsWith("-")) {
    return argv;
  }

  // Top-level command names and aliases are reserved and always win.
  if (knownTopLevelCommandTokens().has(candidate)) {
    return argv;
  }

  let profileNames: Set<string>;
  try {
    const db = getDb();
    initializeSchema(db);
    profileNames = new Set(
      listProfileLayersCommand().map((profile) => profile.name),
    );
  } catch {
    return argv;
  }

  if (!profileNames.has(candidate)) {
    return argv;
  }

  return [argv[0] ?? "node", argv[1] ?? "harnessdeck", "profile", "use", candidate, ...argv.slice(3)];
}

export async function runHarnessdeckCli(
  argv: string[] = process.argv,
): Promise<void> {
  program.name(resolveInvocationName());
  process.exitCode = 0;
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  const effectiveArgv = rewriteProfileShorthandArgv(argv);
  try {
    await program.parseAsync(effectiveArgv);
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
      const commandIndex = effectiveArgv.findIndex(
        (value, index) => index >= 2 && value === commandName,
      );
      const attemptedSubcommand =
        commandIndex >= 0 ? effectiveArgv[commandIndex + 1] : undefined;
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
