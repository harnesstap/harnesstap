import type { Command } from "commander";
import inquirer from "inquirer";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { PROFILE_PLUGIN_TAG, isProfilePlugin } from "../../constants/profile.js";
import { getPlugin, listPlugins } from "../../models/plugin-model.js";
import { getResource, listResources } from "../../models/resource.js";
import { createPluginFromSource } from "../../services/plugin-from-source.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  commitProfileCreate,
  previewProfileCreate,
  type ProfileConflictPolicy,
  type ProfileCreateInput,
  type ProfileCreatePreview,
  type ProfileCreateSource,
} from "../../services/profile-create.js";
import {
  createProfileCommand,
  tagProfileCommand,
  useProfileCommand,
} from "../../services/profile-commands.js";
import { maybePromptProfileEnable } from "../../services/profile-enable-prompt.js";
import { maybeSyncActiveProfileBeforeSwitch } from "../../services/profile-switch-prompt.js";
import {
  resolveSkillPackageCheckout,
  type PluginSourceConflictPolicy,
} from "../../services/skill-package-resolve.js";
import { runPluginCreateFromSourceWizard } from "../../services/wizards/plugin-create-from-source.js";
import {
  isPromptCancellationError,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount } from "../formatting.js";
import { parseCommaSeparatedList } from "./parse-flags.js";
import { collectRepeatedOption } from "../shared.js";

function parsePluginSourceConflictPolicy(
  value: string | undefined,
): PluginSourceConflictPolicy | undefined {
  if (!value) return undefined;
  if (value === "cancel" || value === "merge" || value === "overwrite") {
    return value;
  }
  throw new Error(
    `Invalid --on-conflict value: ${value}. Use cancel, merge, or overwrite.`,
  );
}

export interface ProfileCreateCommandOpts {
  description?: string;
  version?: string;
  from?: string;
  skill?: string;
  all?: boolean;
  excludeCategory?: string[];
  onConflict?: string;
  use?: boolean;
  dryRun?: boolean;
  harness?: string;
  format?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  yes?: boolean;
  onConflictUse?: string;
  account?: string;
  baseUrl?: string;
  pull?: boolean;
  compose?: boolean;
  plugins?: string | string[];
  resources?: string | string[];
  fromHome?: boolean;
  fromProject?: string;
  preview?: boolean;
}

const SINGLE_SOURCE_MESSAGE =
  "Pass only one of --from, --compose, --from-home, or --from-project.";
const PREVIEW_SOURCE_MESSAGE =
  "--preview applies to --compose, --from-home, and --from-project. Skill-package create uses --dry-run.";
const PREVIEW_USE_MESSAGE =
  "Do not combine --preview with --use or --dry-run.";
const COMPOSE_SELECTION_FLAGS_MESSAGE =
  "--plugins and --resources are only valid with --compose.";
const COMPOSE_ON_CONFLICT_MESSAGE =
  "--on-conflict is only valid with --from, --from-home, or --from-project.";

function flattenSelectors(value: string | string[] | undefined): string[] {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  return parts.flatMap((entry) =>
    entry.split(",").map((item) => item.trim()).filter(Boolean),
  );
}

function selectedCreateSources(opts: ProfileCreateCommandOpts): string[] {
  const sources: string[] = [];
  if (opts.from) sources.push("from");
  if (opts.compose) sources.push("compose");
  if (opts.fromHome) sources.push("from-home");
  if (opts.fromProject !== undefined) sources.push("from-project");
  return sources;
}

function isLibraryCreateSource(opts: ProfileCreateCommandOpts): boolean {
  return Boolean(opts.compose || opts.fromHome || opts.fromProject !== undefined);
}

function assertCreateSourceFlags(opts: ProfileCreateCommandOpts): void {
  if (selectedCreateSources(opts).length > 1) {
    throw new Error(SINGLE_SOURCE_MESSAGE);
  }

  const pluginSelectors = flattenSelectors(opts.plugins);
  const resourceSelectors = flattenSelectors(opts.resources);
  if (!opts.compose && (pluginSelectors.length > 0 || resourceSelectors.length > 0)) {
    throw new Error(COMPOSE_SELECTION_FLAGS_MESSAGE);
  }

  if (opts.compose && opts.onConflict !== undefined) {
    throw new Error(COMPOSE_ON_CONFLICT_MESSAGE);
  }

  if (opts.preview && (opts.use || opts.dryRun)) {
    throw new Error(PREVIEW_USE_MESSAGE);
  }

  if (opts.preview && !isLibraryCreateSource(opts)) {
    throw new Error(PREVIEW_SOURCE_MESSAGE);
  }

  if ((opts.fromHome || opts.fromProject !== undefined) && opts.onConflict) {
    if (opts.onConflict !== "skip" && opts.onConflict !== "overwrite") {
      throw new Error(
        `Invalid --on-conflict value: ${opts.onConflict}. Use skip or overwrite.`,
      );
    }
  }
}

function resolvePluginId(selector: string): string {
  const plugin = getPlugin(selector);
  if (!plugin) {
    throw new Error(`Plugin not found: ${selector}`);
  }
  return plugin.id;
}

function resolveResourceId(selector: string): string {
  const resource = getResource(selector);
  if (!resource) {
    throw new Error(`Resource not found: ${selector}`);
  }
  return resource.id;
}

function parseHomeProjectConflictPolicy(
  value: string | undefined,
): ProfileConflictPolicy {
  if (!value) return "skip";
  if (value === "skip" || value === "overwrite") return value;
  throw new Error(`Invalid --on-conflict value: ${value}. Use skip or overwrite.`);
}

async function resolveComposeIds(
  opts: ProfileCreateCommandOpts,
  format: ReturnType<typeof parseOutputFormat>,
): Promise<{ pluginIds: string[]; resourceIds: string[] }> {
  const pluginSelectors = flattenSelectors(opts.plugins);
  const resourceSelectors = flattenSelectors(opts.resources);
  if (pluginSelectors.length > 0 || resourceSelectors.length > 0) {
    return {
      pluginIds: pluginSelectors.map(resolvePluginId),
      resourceIds: resourceSelectors.map(resolveResourceId),
    };
  }

  const shouldPrompt = shouldUseWizard({
    noInteractive: opts.noInteractive ?? opts.yes ?? opts.interactive === false,
    interactive: opts.interactive,
    format,
    missingRequiredArgs: true,
  });
  if (!shouldPrompt) {
    throw new Error(
      "A composed profile requires at least one plugin or resource selection",
    );
  }

  return promptComposeSelections();
}

async function promptComposeSelections(): Promise<{
  pluginIds: string[];
  resourceIds: string[];
}> {
  const answers = await inquirer.prompt<{
    pluginIds: string[];
    resourceIds: string[];
  }>([
    {
      type: "checkbox",
      name: "pluginIds",
      message: "Plugins to attach",
      choices: listPlugins().map((plugin) => ({
        name: plugin.name,
        value: plugin.id,
      })),
    },
    {
      type: "checkbox",
      name: "resourceIds",
      message: "Resources to add",
      choices: listResources().map((resource) => ({
        name: `${resource.type}: ${resource.name}`,
        value: resource.id,
      })),
    },
  ]);
  return {
    pluginIds: answers.pluginIds ?? [],
    resourceIds: answers.resourceIds ?? [],
  };
}

function conflictLabel(conflict: unknown, index: number): string {
  if (typeof conflict !== "object" || conflict === null) {
    return String(conflict);
  }
  const row = conflict as Record<string, unknown>;
  if (typeof row.name === "string") {
    const type = typeof row.type === "string" ? `${row.type}: ` : "";
    return `${type}${row.name}`;
  }
  if (typeof row.existingResource === "object" && row.existingResource !== null) {
    const resource = row.existingResource as Record<string, unknown>;
    if (typeof resource.name === "string") {
      const type =
        typeof resource.type === "string" ? `${resource.type}: ` : "";
      return `${type}${resource.name}`;
    }
  }
  return `Conflict ${index + 1}`;
}

function sourcePhrase(source: ProfileCreateSource): string {
  switch (source) {
    case "compose":
      return "compose";
    case "home":
      return "home";
    case "project":
      return "project";
    default: {
      const exhaustive: never = source;
      throw new Error(`Unsupported profile create source: ${String(exhaustive)}`);
    }
  }
}

function printHumanPreview(preview: ProfileCreatePreview): void {
  ui.success(`Would create profile ${ui.theme.accent(preview.name)} from ${sourcePhrase(preview.source)}`);
  ui.kvBlock([
    { key: "Imports", value: String(preview.totalImports) },
    { key: "Conflicts", value: String(preview.conflicts.length) },
    { key: "Warnings", value: String(preview.warnings.length) },
  ]);
  preview.conflicts.forEach((conflict, index) => {
    ui.info(conflictLabel(conflict, index));
  });
  for (const warning of preview.warnings) {
    ui.warn(warning);
  }
  ui.hint(
    "Re-run without --preview to create. Use --on-conflict overwrite to replace library copies.",
  );
}

async function buildLibraryCreateInput(
  name: string,
  opts: ProfileCreateCommandOpts,
  format: ReturnType<typeof parseOutputFormat>,
): Promise<ProfileCreateInput> {
  if (opts.compose) {
    const selections = await resolveComposeIds(opts, format);
    return {
      source: "compose",
      name,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      pluginIds: selections.pluginIds,
      resourceIds: selections.resourceIds,
    };
  }
  if (opts.fromHome) {
    return {
      source: "home",
      name,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      conflictPolicy: parseHomeProjectConflictPolicy(opts.onConflict),
    };
  }
  if (opts.fromProject !== undefined) {
    return {
      source: "project",
      name,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      projectPath: opts.fromProject,
      conflictPolicy: parseHomeProjectConflictPolicy(opts.onConflict),
    };
  }
  throw new Error(SINGLE_SOURCE_MESSAGE);
}

async function handleLibraryProfileCreate(
  name: string,
  opts: ProfileCreateCommandOpts,
  format: ReturnType<typeof parseOutputFormat>,
): Promise<"preview" | "committed"> {
  const input = await buildLibraryCreateInput(name, opts, format);
  if (opts.preview) {
    const preview = await previewProfileCreate(input);
    if (format === "json") {
      printJson(preview);
    } else {
      printHumanPreview(preview);
    }
    return "preview";
  }

  const result = await commitProfileCreate(input);
  if (format === "json") {
    if (!opts.use) {
      printJson(result);
    }
    return "committed";
  }
  ui.success(
    `Created profile ${ui.theme.accent(result.profile.name)} ${ui.icons.bullet} ${formatCount(result.imported_count, "imported", "imported")}`,
  );
  return "committed";
}

export async function handleProfileCreateCommand(
  name: string,
  opts: ProfileCreateCommandOpts,
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const db = getDb();
  initializeSchema(db);
  const version = opts.version ?? "1.0.0";

  assertCreateSourceFlags(opts);

  if (isLibraryCreateSource(opts)) {
    const libraryResult = await handleLibraryProfileCreate(name, opts, format);
    if (libraryResult === "preview") {
      return;
    }
    if (format === "json" && !opts.use) {
      return;
    }
  } else if (opts.from) {
    const harnesstapDir = getHarnesstapDir();
    const homeRoot = resolveHomeRoot();
    const skillNames = parseCommaSeparatedList(opts.skill);
    const excludeCategories = [
      ...(opts.excludeCategory ?? []),
    ].flatMap((entry) => entry.split(",").map((part) => part.trim()).filter(Boolean));
    const onConflictFlag = parsePluginSourceConflictPolicy(opts.onConflict);
    const harnesses = parseCommaSeparatedList(opts.harness);
    if (harnesses) {
      assertSupportedHarnessTargets(harnesses);
    }

    const resolvedPackage = resolveSkillPackageCheckout(opts.from, harnesstapDir);
    const shouldPrompt = shouldUseWizard({
      noInteractive: opts.yes,
      interactive: opts.interactive,
      format,
      missingRequiredArgs: !opts.all && (!skillNames || skillNames.length === 0),
    });

    const wizard = await runPluginCreateFromSourceWizard({
      pluginName: name,
      pluginVersion: version,
      discovered: resolvedPackage.discovered,
      skillNames,
      all: opts.all,
      excludeCategories: excludeCategories.length > 0 ? excludeCategories : undefined,
      onConflict: onConflictFlag,
      shouldPrompt,
    });

    if (wizard.cancelled) {
      ui.info("Operation cancelled.");
      return;
    }

    const result = await createPluginFromSource({
      name,
      source: opts.from,
      version,
      description: opts.description,
      tags: [PROFILE_PLUGIN_TAG],
      skillNames: wizard.skillNames,
      all: wizard.all,
      excludeCategories: excludeCategories.length > 0 ? excludeCategories : undefined,
      onConflict: onConflictFlag ?? wizard.onConflict,
      dryRun: opts.dryRun,
      homeRoot,
      harnesstapDir,
    });

    if (!isProfilePlugin(result.plugin)) {
      tagProfileCommand(result.plugin.name);
    }

    if (opts.dryRun && !opts.use) {
      if (format === "json") {
        printJson({
          plugin: result.plugin,
          created: true,
          promoted: true,
          namespace: result.namespace,
          attached_skills: result.attachedSkills,
        });
        return;
      }
      ui.success(
        `Dry run ${ui.icons.hint} would create profile ${ui.theme.accent(result.plugin.name)} with ${formatCount(result.attachedSkills.length, "skill")} from ${result.namespace}`,
      );
      return;
    }

    if (format !== "json") {
      ui.success(
        `Created profile ${ui.theme.accent(result.plugin.name)} ${ui.icons.bullet} ${formatCount(result.attachedSkills.length, "skill")} attached from ${result.namespace}`,
      );
    } else if (!opts.use) {
      printJson({
        plugin: result.plugin,
        created: true,
        promoted: true,
        namespace: result.namespace,
        attached_skills: result.attachedSkills,
      });
      return;
    }
  } else {
    const result = createProfileCommand({
      name,
      description: opts.description,
      version,
    });

    if (format === "json" && !opts.use) {
      printJson(result);
      return;
    }

    if (result.created) {
      ui.success(`Created profile ${ui.theme.accent(result.plugin.name)}`);
    } else if (result.promoted) {
      ui.success(`Tagged plugin ${ui.theme.accent(result.plugin.name)} as profile`);
    } else {
      ui.info(`Profile ${ui.theme.accent(result.plugin.name)} already exists`);
    }
  }

  if (opts.use) {
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflictUse,
    });
    try {
      if (!opts.dryRun) {
        await maybeSyncActiveProfileBeforeSwitch({
          targetProfileName: name,
          harness: opts.harness,
          yes: opts.yes,
          format,
        });
      }
      const applied = await useProfileCommand(name, {
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
        printJson({ apply: applied });
        return;
      }
      if (applied.cancelled) {
        process.exitCode = 1;
        ui.warn("Profile apply cancelled.");
        return;
      }
      const dryPrefix = applied.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Applied profile ${ui.theme.accent(applied.profile_name)} to ${applied.harnesses.join(", ") || "(none)"}`,
      );
      return;
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  if (format === "json") {
    return;
  }

  try {
    await maybePromptProfileEnable({
      profileName: name,
      format: opts.format,
      yes: opts.yes,
      harness: opts.harness,
      pull: opts.pull,
      account: opts.account,
      baseUrl: opts.baseUrl,
      onConflictUse: opts.onConflictUse,
    });
  } catch (err) {
    if (isPromptCancellationError(err)) {
      ui.info("Operation cancelled.");
      return;
    }
    throw err;
  }
}

export function registerProfileCreateSourceOptions(command: Command): Command {
  return command
    .option("--compose", "Create by attaching library plugins and resources")
    .option(
      "--plugins <selectors>",
      "Compose: plugin names or ids (comma-separated, repeatable)",
      collectRepeatedOption,
      [],
    )
    .option(
      "--resources <selectors>",
      "Compose: resource names or ids (comma-separated, repeatable)",
      collectRepeatedOption,
      [],
    )
    .option("--from-home", "Import from global home harness files")
    .option("--from-project <path>", "Import from a project path")
    .option("--preview", "Print create preview without writing")
    .option("--no-interactive", "Disable interactive compose picking and enable prompts");
}

export function registerProfileCreateCommand(profileCmd: Command): void {
  profileCmd
    .command("create")
    .argument("<name>", "Profile plugin name")
    .option("-d, --description <text>", "Profile description")
    .option("--version <semver>", "Plugin version when creating from a source", "1.0.0")
    .option(
      "--from <source>",
      "Skill package source (owner/repo, git URL, or local path)",
    )
    .option("--skill <names>", "Comma-separated skills to attach when using --from")
    .option("--all", "Attach all discovered skills when using --from")
    .option(
      "--exclude-category <names>",
      "Exclude skill categories when using --from (repeatable or comma-separated)",
      collectRepeatedOption,
      [],
    )
    .option(
      "--on-conflict <policy>",
      "When plugin exists during --from: merge, overwrite, or cancel",
    )
    .option("--use", "Apply globally and set as the active profile")
    .option("--dry-run", "Preview profile apply when used with --use")
    .option("--harness <slugs>", "Harness targets for --use")
    .option(
      "--on-conflict-use <policy>",
      "When applying with --use: replace, skip, or prompt",
    )
    .option("--account <name>", "Cloud account for dependency pulls during --use")
    .option("--base-url <url>", "Cloud base URL for dependency pulls during --use")
    .option("--no-pull", "Do not auto-pull missing published dependencies during --use")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--interactive", "Prompt for skill selection when using --from")
    .option("-y, --yes", "Skip prompts when using --from")
    .description("Create a profile plugin, promote an existing plugin, or import from a skill package")
    .action(async (name: string, opts: {
      description?: string;
      version?: string;
      from?: string;
      skill?: string;
      all?: boolean;
      excludeCategory?: string[];
      onConflict?: string;
      use?: boolean;
      dryRun?: boolean;
      harness?: string;
      onConflictUse?: string;
      account?: string;
      baseUrl?: string;
      pull?: boolean;
      format?: string;
      interactive?: boolean;
      yes?: boolean;
    }) => {
      try {
        await handleProfileCreateCommand(name, opts);
      } catch (err) {
        process.exitCode = 1;
        if (isPromptCancellationError(err)) {
          return;
        }
        ui.danger(err instanceof Error ? err.message : String(err));
      }
    });
}
