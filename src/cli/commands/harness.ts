import { resolve } from "node:path";
import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  getProjectHarnessConfig,
  getHarnessPreference,
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
import { getDedicatedSerializerPlatformIds } from "../../services/platform-serializers.js";
import { detectPlatforms } from "../../services/scanner.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { parseHarnessAliases } from "../handlers/parse-flags.js";
import { configureCommandGroup } from "../help.js";
import { formatCommand, reportNoGitOrigin } from "../shared.js";
import { shouldUseWizard } from "../../services/wizards/shared.js";

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
