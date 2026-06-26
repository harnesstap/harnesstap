import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  CANONICAL_CATALOG_BASELINE,
  CANONICAL_CATALOG_SEARCH_HINT,
} from "../../constants/onboarding.js";
import { PROFILE_LAYER_TAG, isProfileLayer } from "../../constants/profile.js";
import { getDb, getDbPath, getHarnessdeckDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  getHarnessPreference,
  setHarnessPreference,
} from "../../models/harness.js";
import {
  addResourceToLayer,
  createLayer,
  getLayerResources,
  listLayers,
} from "../../models/layer-model.js";
import { getAllPlatforms } from "../../platforms/registry.js";
import { addSkillPackage } from "../../services/add-package.js";
import { setActiveProfileName } from "../../services/active-profile.js";
import { resolveHarnessSelection } from "../../services/harness-config.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import { maybePromptInitCatalogInstall } from "../../services/init-catalog-prompt.js";
import { scanAndPersistHomeDefaults } from "../../services/scanner.js";
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
    `  ${formatCommand(`layer list --search ${CANONICAL_CATALOG_SEARCH_HINT} --remote-only`)}`,
  );
  console.log(
    `  ${formatCommand(`layer apply ${CANONICAL_CATALOG_BASELINE}`)}`,
  );
  console.log(`  ${formatCommand("help")}`);
  ui.dim(`Enable tab completion: ${formatCommand("completion zsh >> ~/.zshrc")}`);
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

  const resolvedPackage = resolveSkillPackageCheckout(source, harnessdeckDir);
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

export function registerInitCommands(root: Command): void {
  root
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

  root
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
}
