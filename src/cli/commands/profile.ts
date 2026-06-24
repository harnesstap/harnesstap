import type { Command } from "commander";
import { getDb, getHarnessdeckDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { PROFILE_LAYER_TAG, isProfileLayer } from "../../constants/profile.js";
import { getLayer, resolveLayerSelector } from "../../models/layer-model.js";
import { listAttachedLayerRefs } from "../../services/layer-composition.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { createLayerFromSource } from "../../services/layer-from-source.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import { handleLayerListCommand, warnProfileSearchDeprecated } from "../../services/layer-list.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  createProfileCommand,
  deleteProfileCommand,
  listProfileLayersCommand,
  showProfileCommand,
  tagProfileCommand,
  useProfileCommand,
} from "../../services/profile-commands.js";
import { detectGlobalProfileStatus } from "../../services/global-profile-drift.js";
import { maybePromptProfileEnable } from "../../services/profile-enable-prompt.js";
import { maybePromptProfileLayerDelete } from "../../services/profile-delete-prompt.js";
import { maybeSyncActiveProfileBeforeSwitch } from "../../services/profile-switch-prompt.js";
import { handleProfileUseProjectDelegation } from "../../services/use-command.js";
import {
  resolveSkillPackageCheckout,
  type LayerSourceConflictPolicy,
} from "../../services/skill-package-resolve.js";
import { runLayerCreateFromSourceWizard } from "../../services/wizards/layer-create-from-source.js";
import {
  isPromptCancellationError,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import type { Layer } from "../../types.js";
import { ui } from "../../ui/index.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount, formatLayerLabel } from "../formatting.js";
import { configureCommandGroup } from "../help.js";
import { handleLayerInstallCommand } from "../handlers/layer-install.js";
import { parseCommaSeparatedList } from "../handlers/parse-flags.js";
import {
  countMaterialLayerResources,
  handleLayerPublishCommand,
} from "../handlers/layer-publish.js";
import { handleLayerShowCommand } from "../handlers/layer-show-command.js";
import { resolveLayerMutationTarget } from "../handlers/resolve-layer-mutation-target.js";
import { renderCliError } from "../runtime.js";
import { collectRepeatedOption, formatCommand } from "../shared.js";
async function handleProfileSearchCommand(
  query: string,
  opts: { account?: string; format?: string; baseUrl?: string; noInteractive?: boolean },
) {
  warnProfileSearchDeprecated();
  await handleLayerListCommand({
    search: query,
    remoteOnly: true,
    tag: PROFILE_LAYER_TAG,
    profileMode: true,
    format: parseOutputFormat(opts.format),
    account: opts.account,
    baseUrl: opts.baseUrl,
    noInteractive: opts.noInteractive,
  });
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
  await handleLayerPublishCommand(layerName, undefined, opts);
}

function parseLayerSourceConflictPolicy(
  value: string | undefined,
): LayerSourceConflictPolicy | undefined {
  if (!value) return undefined;
  if (value === "cancel" || value === "merge" || value === "overwrite") {
    return value;
  }
  throw new Error(
    `Invalid --on-conflict value: ${value}. Use cancel, merge, or overwrite.`,
  );
}

async function handleProfileCreateCommand(
  name: string,
  opts: {
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
    yes?: boolean;
    onConflictUse?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const db = getDb();
  initializeSchema(db);
  const version = opts.version ?? "1.0.0";

  if (opts.from) {
    const harnessdeckDir = getHarnessdeckDir();
    const homeRoot = resolveHomeRoot();
    const skillNames = parseCommaSeparatedList(opts.skill);
    const excludeCategories = [
      ...(opts.excludeCategory ?? []),
    ].flatMap((entry) => entry.split(",").map((part) => part.trim()).filter(Boolean));
    const onConflictFlag = parseLayerSourceConflictPolicy(opts.onConflict);
    const harnesses = parseCommaSeparatedList(opts.harness);
    if (harnesses) {
      assertSupportedHarnessTargets(harnesses);
    }

    const resolvedPackage = resolveSkillPackageCheckout(opts.from, harnessdeckDir);
    const shouldPrompt = shouldUseWizard({
      noInteractive: opts.yes,
      interactive: opts.interactive,
      format,
      missingRequiredArgs: !opts.all && (!skillNames || skillNames.length === 0),
    });

    const wizard = await runLayerCreateFromSourceWizard({
      layerName: name,
      layerVersion: version,
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

    const result = await createLayerFromSource({
      name,
      source: opts.from,
      version,
      description: opts.description,
      tags: [PROFILE_LAYER_TAG],
      skillNames: wizard.skillNames,
      all: wizard.all,
      excludeCategories: excludeCategories.length > 0 ? excludeCategories : undefined,
      onConflict: onConflictFlag ?? wizard.onConflict,
      dryRun: opts.dryRun,
      homeRoot,
      harnessdeckDir,
    });

    if (!isProfileLayer(result.layer)) {
      tagProfileCommand(result.layer.name);
    }

    if (opts.dryRun && !opts.use) {
      if (format === "json") {
        printJson({
          layer: result.layer,
          created: true,
          promoted: true,
          namespace: result.namespace,
          attached_skills: result.attachedSkills,
        });
        return;
      }
      ui.success(
        `Dry run ${ui.icons.hint} would create profile ${ui.theme.accent(result.layer.name)} with ${formatCount(result.attachedSkills.length, "skill")} from ${result.namespace}`,
      );
      return;
    }

    if (format !== "json") {
      ui.success(
        `Created profile ${ui.theme.accent(result.layer.name)} ${ui.icons.bullet} ${formatCount(result.attachedSkills.length, "skill")} attached from ${result.namespace}`,
      );
    } else if (!opts.use) {
      printJson({
        layer: result.layer,
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
      ui.success(`Created profile ${ui.theme.accent(result.layer.name)}`);
    } else if (result.promoted) {
      ui.success(`Tagged layer ${ui.theme.accent(result.layer.name)} as profile`);
    } else {
      ui.info(`Profile ${ui.theme.accent(result.layer.name)} already exists`);
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
export function registerProfileCommands(root: Command): void {
  const profileCmd = configureCommandGroup(
  root
    .command("profile")
    .alias("p")
    .description("Manage profile layers and global profile switching"),
);

profileCmd
  .command("list")
  .alias("ls")
  .option("-s, --search <query>", "Filter by name, description, or tags (local and remote)")
  .option("--local-only", "List only local profile layers")
  .option("--remote-only", "List only remote catalog profile layers")
  .option("--account <name>", "Cloud account to use for remote listing")
  .option("--base-url <url>", "HarnessDeck Cloud base URL")
  .option("--no-interactive", "Disable interactive wizards")
  .option("--interactive", "Enable interactive wizards")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List local profile layers and remote catalog profiles")
  .action(async (opts: {
    search?: string;
    localOnly?: boolean;
    remoteOnly?: boolean;
    account?: string;
    baseUrl?: string;
    noInteractive?: boolean;
    interactive?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    try {
      await handleLayerListCommand({
        profileMode: true,
        localLayersProvider: listProfileLayersCommand,
        tag: PROFILE_LAYER_TAG,
        search: opts.search,
        localOnly: opts.localOnly,
        remoteOnly: opts.remoteOnly,
        format: parseOutputFormat(opts.format),
        account: opts.account,
        baseUrl: opts.baseUrl,
        noInteractive: opts.noInteractive,
        interactive: opts.interactive,
      });
    } catch (error) {
      if (isPromptCancellationError(error)) {
        process.exitCode = 1;
        return;
      }
      process.exitCode = 1;
      ui.danger(error instanceof Error ? error.message : String(error));
    }
  });

profileCmd
  .command("show")
  .argument("[name]", "Profile layer name or selector")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Show profile layer details, resources, and dependencies")
  .action(async (
    name: string | undefined,
    opts: {
      format?: string;
      showId?: boolean;
      interactive?: boolean;
      noInteractive?: boolean;
    },
  ) => {
    const db = getDb();
    initializeSchema(db);
    const resolvedName = name ?? await resolveLayerMutationTarget({
      layerName: name,
      profileMode: true,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
      message: "Which profile do you want to show?",
    });
    if (!resolvedName) {
      process.exitCode = 1;
      renderCliError(missingRequiredArg("name", "profile show"));
      return;
    }
    const payload = showProfileCommand(resolvedName);
    handleLayerShowCommand(formatLayerLabel(payload.profile), opts, {
      active: payload.active,
    });
  });

profileCmd
  .command("status")
  .option("--harness <slugs>", "Comma-separated harness slugs (defaults to global harness preference)")
  .option("--check", "Exit with code 1 when global state is out of sync with the active profile")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show the active profile and whether global harness files are in sync")
  .action(async (opts: {
    harness?: string;
    check?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    try {
      const status = await detectGlobalProfileStatus({ harness: opts.harness });
      if (format === "json") {
        printJson(status);
      } else if (!status.active_profile) {
        ui.info("No active profile set.");
      } else if (status.warning) {
        ui.warn(status.warning);
      } else if (!status.applied) {
        ui.warn(
          `Active profile ${ui.theme.accent(status.active_profile)} has not been applied globally yet.`,
        );
        ui.hint(`Run ${formatCommand(`profile use ${status.active_profile}`)} to materialize home harness files.`);
      } else if (!status.has_drift) {
        ui.success(`Global harness files are in sync with profile ${ui.theme.accent(status.active_profile)}.`);
      } else {
        ui.warn(
          `Global harness files are out of sync with profile ${ui.theme.accent(status.active_profile)}.`,
        );
        if (!status.stack_in_sync) {
          ui.dim("Profile stack changed since the last global apply.");
        }
        if (status.changes.length > 0) {
          ui.dim(`${status.changes.length} file(s) differ on disk.`);
        }
        ui.hint(`Run ${formatCommand(`profile use ${status.active_profile}`)} to refresh global harness files.`);
      }

      if (opts.check && status.has_drift) {
        process.exitCode = 1;
      }
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

profileCmd
  .command("use")
  .argument("[name]", "Profile layer name or selector")
  .option("--profile <name>", "Profile key from .harnessdeck/config.toml")
  .option("--project <path>", "Project directory for config.toml discovery", ".")
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
  .option("--force", "Apply even when the profile is already active and in sync")
  .option("--no-interactive", "Disable interactive prompts")
  .option("--interactive", "Enable interactive prompts")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Switch the active profile and apply globally to harness home paths")
  .action(async (name: string | undefined, opts: {
    profile?: string;
    project?: string;
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
    force?: boolean;
    interactive?: boolean;
    noInteractive?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);

    if (!name) {
      if (await handleProfileUseProjectDelegation(opts)) {
        return;
      }
      const globalProfileName = opts.profile;
      if (!globalProfileName) {
        process.exitCode = 1;
        ui.danger("Profile name is required when no project config is present.");
        return;
      }
      name = globalProfileName;
    }

    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflict,
      noInteractive: opts.noInteractive ?? format === "json",
    });
    try {
      if (!opts.dryRun) {
        await maybeSyncActiveProfileBeforeSwitch({
          targetProfileName: name,
          harness: opts.harness,
          format,
        });
      }
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
  .option("--version <semver>", "Layer version when creating from a source", "1.0.0")
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
    "When layer exists during --from: merge, overwrite, or cancel",
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
  .description("Create a profile layer, promote an existing layer, or import from a skill package")
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

profileCmd
  .command("delete")
  .argument("<name>", "Profile layer name or selector")
  .option("--layer", "Also delete the underlying layer without prompting")
  .option("-y, --yes", "Skip the interactive layer delete prompt")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Demote a profile layer and optionally delete the underlying layer")
  .action(async (name: string, opts: {
    layer?: boolean;
    yes?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    try {
      const demoted = deleteProfileCommand(name);
      let layerDeleted = false;
      if (opts.layer || format === "human") {
        layerDeleted = await maybePromptProfileLayerDelete({
          layerName: demoted.layer_name,
          layerId: demoted.layer_id,
          format: opts.format,
          yes: opts.yes,
          deleteLayerFlag: opts.layer,
        });
      }

      if (format === "json") {
        printJson({
          ...demoted,
          layer_deleted: layerDeleted,
        });
        return;
      }

      ui.success(`Demoted profile ${ui.theme.accent(demoted.layer_name)}`);
      if (demoted.was_active) {
        ui.info("Cleared active profile pointer.");
      }
      if (layerDeleted) {
        ui.success(`Deleted layer ${ui.theme.accent(demoted.layer_name)}`);
      }
    } catch (err) {
      process.exitCode = 1;
      if (isPromptCancellationError(err)) {
        ui.info("Operation cancelled.");
        return;
      }
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

profileCmd
  .command("search")
  .argument("<query>", "Search query")
  .option("--account <name>", "Cloud account name")
  .option("--base-url <url>", "Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--no-interactive", "Disable interactive wizards")
  .description("Search catalog profile layers (deprecated: use profile list --search)")
  .action(async (query: string, opts: {
    account?: string;
    baseUrl?: string;
    format?: string;
    noInteractive?: boolean;
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
}
