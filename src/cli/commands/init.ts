import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "../../constants/onboarding.js";
import { PROFILE_PLUGIN_TAG, isProfilePlugin } from "../../constants/profile.js";
import { getDb, getDbPath, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  getHarnessPreference,
  setHarnessPreference,
} from "../../models/harness.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginResources,
  listPlugins,
} from "../../models/plugin-model.js";
import { getAllPlatforms } from "../../platforms/registry.js";
import { addSkillPackage } from "../../services/add-package.js";
import { setActiveProfileName } from "../../services/active-profile.js";
import { ensureDefaultEnvironment } from "../../services/ensure-default-environment.js";
import { resolveHarnessSelection } from "../../services/harness-config.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import { maybePromptInitCatalogInstall } from "../../services/init-catalog-prompt.js";
import { maybePromptInitCompletionInstall } from "../../services/init-completion-install.js";
import { scanAndPersistHomeDefaults } from "../../services/scanner.js";
import { renderShellCompletion } from "../../services/shell-completion.js";
import {
  resolveSkillPackageCheckout,
} from "../../services/skill-package-resolve.js";
import { runAddPackageWizard } from "../../services/wizards/add-package.js";
import {
  isPromptCancellationError,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import type { Resource, ResourceType } from "../../types.js";
import { RESOURCE_TYPES } from "../../types.js";
import { ui } from "../../ui/index.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount } from "../formatting.js";
import {
  parseCommaSeparatedList,
  parseHarnessAliases,
  resolveAddScope,
} from "../handlers/parse-flags.js";
import { formatCommand } from "../shared.js";

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

function printQuickStartGuide(): void {
  console.log("");
  ui.subheader("NEXT STEPS");
  console.log("");
  console.log(`  ${formatCommand("profile use default")}`);
  console.log(
    `  ${formatCommand(`plugin list --search ${CANONICAL_CATALOG_SEARCH_HINT} --remote-only`)}`,
  );
  console.log(
    `  ${formatCommand(`apply ${CANONICAL_CATALOG_BASELINE}`)}`,
  );
  console.log(`  ${formatCommand("help")}`);
  ui.dim(`Enable tab completion: ${formatCommand("init completion zsh >> ~/.zshrc")}`);
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
    plugin?: string;
    createPlugin?: string;
    list?: boolean;
    dryRun?: boolean;
    yes?: boolean;
    format?: string;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnesstapDir = getHarnesstapDir();
  const homeRoot = resolveHomeRoot();

  if (opts.plugin && opts.createPlugin) {
    throw new Error("Pass only one of --plugin or --create-plugin.");
  }

  const method = opts.method === "copy" ? "copy" : opts.method === "symlink" || !opts.method
    ? "symlink"
  : (() => {
      throw new Error(`Invalid --method value: ${opts.method}. Use symlink or copy.`);
    })();

  const resolvedPackage = resolveSkillPackageCheckout(source, harnesstapDir);
  const { namespace } = resolvedPackage;
  const discovered = resolvedPackage.discovered;

  if (opts.list) {
    const payload = {
      source,
      namespace,
      primary: "skill-package",
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
    createPlugin: opts.createPlugin,
    plugin: opts.plugin,
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
    harnesstapDir,
    createPlugin: wizard.createPlugin,
    plugin: wizard.plugin,
    dryRun: opts.dryRun,
  });

  const payload = {
    source,
    namespace: result.namespace,
    discovered: discovered.map((skill) => skill.name),
    imported: result.importedSkills,
    installed: result.installedSkills,
    snapshot_id: result.snapshotId,
    ...(result.plugin ? { plugin: result.plugin } : {}),
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
  ensureDefaultEnvironment();
  const format = parseOutputFormat(opts.format);
  if (format === "human" && hadExistingStore) {
    const preference = getHarnessPreference();
    ui.warn(
      "~/.harnesstap already exists. Harness preferences stay unchanged unless you pass --main or --aliases.",
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
      (resource) => resource.type !== "plugin",
    );
    let defaultProfilePlugin = listPlugins().find(
      (plugin) => plugin.name === "default" && isProfilePlugin(plugin),
    );
    const shouldSeedDefaultProfile =
      !defaultProfilePlugin
      || getPluginResources(defaultProfilePlugin.id).filter(
        (resource) => resource.type !== "plugin",
      ).length === 0;

    if (!defaultProfilePlugin) {
      defaultProfilePlugin = createPlugin({
        name: "default",
        version: "1.0.0",
        description: "Bootstrap profile from init",
        tags: [PROFILE_PLUGIN_TAG],
      });
    }

    if (shouldSeedDefaultProfile) {
      for (const resource of homeProfileResources) {
        addResourceToPlugin(defaultProfilePlugin.id, resource.id);
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

  ui.success("HarnessTap initialized");
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

  const canPromptCompletion =
    format === "human"
    && !opts.noInteractive
    && !process.argv.includes("--no-interactive")
    && Boolean(process.stdin.isTTY && process.stdout.isTTY)
    && !["1", "true", "yes"].includes(process.env.CI?.trim().toLowerCase() ?? "")
    && (opts.interactive === true || useWizard);

  if (canPromptCompletion) {
    try {
      await maybePromptInitCompletionInstall({
        format,
        interactive: true,
      });
    } catch (err) {
      if (!isPromptCancellationError(err)) throw err;
    }
  }

  const canPromptCatalog =
    format === "human"
    && !opts.noInteractive
    && !process.argv.includes("--no-interactive")
    && Boolean(process.stdin.isTTY && process.stdout.isTTY)
    && !["1", "true", "yes"].includes(process.env.CI?.trim().toLowerCase() ?? "")
    && (opts.interactive === true || useWizard)
    && listPlugins().length === 0;

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

export function registerInitCommands(root: Command): void {
  const initCmd = root
    .command("init")
    .description("Initialize the harnesstap database and config directory")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--main <slug>", "Default main harness slug")
    .option("--aliases <slugs>", "Comma-separated alias harness slugs")
    .option("--no-default-profile", "Skip creating and activating the default profile plugin")
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

  initCmd
    .command("completion")
    .argument("<shell>", "Target shell: bash, zsh, or fish (must match your interactive shell)")
    .description(
      "Print shell completion script to stdout (redirect into ~/.bashrc, ~/.zshrc, or fish completions)",
    )
    .action((shell: string) => {
      try {
        process.stdout.write(renderShellCompletion(shell, root));
      } catch (err) {
        process.exitCode = 1;
        ui.danger(err instanceof Error ? err.message : String(err));
      }
    });

  root
    .command("add")
    .argument("<source>", "GitHub owner/repo, Git URL, or local path")
    .option("--skill <names>", "Skills to install (comma-separated)")
    .option("--all", "Install all discovered skills")
    .option("--harness <slugs>", "Target harnesses")
    .option("--global", "Install to user home")
    .option("--project [path]", "Install to project directory")
    .option("--method <mode>", "symlink or copy", "symlink")
    .option("--plugin <name>", "Combine into existing plugin")
    .option("--create-plugin <name>", "Create plugin and attach skills")
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
      plugin?: string;
      createPlugin?: string;
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
}
