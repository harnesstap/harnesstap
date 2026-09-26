import { resolve } from "node:path";
import type { Command } from "commander";
import { loadSettings } from "../../config/settings.js";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  getHarnessPreference,
  getProjectHarnessConfig,
  setHarnessPreference,
  setProjectHarnessConfig,
} from "../../models/harness.js";
import { getProjectByOrigin, upsertProject } from "../../models/project.js";
import { getAllPlatforms } from "../../platforms/registry.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "../../services/git.js";
import { resolveHarnessSelection } from "../../services/harness-config.js";
import {
  HarnessUnionSyncError,
  syncConfiguredHarnesses,
} from "../../services/harness-union-sync.js";
import { getDedicatedSerializerPlatformIds } from "../../services/platform-serializers.js";
import {
  DEFAULT_PLUGIN_RESOURCE_MODE,
  parsePluginResourceMode,
} from "../../services/plugin-resource-mode.js";
import { detectPlatforms } from "../../services/scanner.js";
import { shouldUseWizard } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { parseHarnessAliases } from "../handlers/parse-flags.js";
import { configureCommandGroup } from "../help.js";
import { formatCommand, reportNoGitOrigin } from "../shared.js";

const NATIVE_HARNESS_IDS = new Set(getDedicatedSerializerPlatformIds());

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
      [
        "Plugin resources",
        loadSettings(getHarnesstapDir()).harnessSync.pluginResources,
      ],
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

async function handleHarnessSyncCommand(opts: {
  project?: string;
  dryRun?: boolean;
  format?: string;
  pluginResources?: string;
}): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const scope = opts.project ? "project" : "global";
  const pluginResourceMode = opts.pluginResources
    ? parsePluginResourceMode(opts.pluginResources)
    : undefined;
  try {
    const result = await syncConfiguredHarnesses({
      scope,
      ...(opts.project ? { projectRoot: resolve(opts.project) } : {}),
      dryRun: opts.dryRun,
      ...(pluginResourceMode ? { pluginResourceMode } : {}),
    });
    if (format === "json") {
      printJson(result);
      return;
    }
    const verb = opts.dryRun ? "Would sync" : "Synced";
    ui.success(
      `${verb} ${result.platforms_synced.join(", ")} ${ui.icons.hint} ${result.files_written} files`,
    );
    if (result.conflicts.length > 0) {
      ui.dim(
        `${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} resolved with ${result.main_harness} winning`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    ui.danger(message, {
      hints:
        error instanceof HarnessUnionSyncError && error.code === "need_two_harnesses"
          ? [formatCommand("harness set --main <slug> --aliases <slugs>")]
          : [formatCommand("harness set --main <slug> --aliases <slugs>")],
    });
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

export function registerHarnessCommands(root: Command): void {
  const harnessCmd = configureCommandGroup(
    root
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

  harnessCmd
    .command("sync")
    .option("--project <path>", "Sync a git-backed project instead of home")
    .option("--dry-run", "Show what would be written without writing files")
    .option(
      "--plugin-resources <mode>",
      `How to materialize Cursor/Claude plugin files into .agents: symlink, copy, or clone (default ${DEFAULT_PLUGIN_RESOURCE_MODE}, or harnessSync.pluginResources in config.jsonc)`,
    )
    .option("--format <mode>", "Output format: human or json", "human")
    .description(
      "Union resources from configured harnesses and materialize with main-wins conflicts",
    )
    .action(handleHarnessSyncCommand);

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
}
