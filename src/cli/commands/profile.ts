import type { Command } from "commander";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { PROFILE_PLUGIN_TAG, isProfilePlugin } from "../../constants/profile.js";
import { getPlugin, resolvePluginSelector } from "../../models/plugin-model.js";
import { listAttachedPluginRefs } from "../../services/plugin-composition.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { createPluginFromSource } from "../../services/plugin-from-source.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import { handlePluginListCommand } from "../../services/plugin-list.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  createProfileCommand,
  deleteProfileCommand,
  listProfilePluginsCommand,
  showProfileCommand,
  tagProfileCommand,
  useProfileCommand,
} from "../../services/profile-commands.js";
import { detectGlobalProfileStatus } from "../../services/global-profile-drift.js";
import { maybePromptProfileEnable } from "../../services/profile-enable-prompt.js";
import { maybePromptProfilePluginDelete } from "../../services/profile-delete-prompt.js";
import { maybeSyncActiveProfileBeforeSwitch } from "../../services/profile-switch-prompt.js";
import {
  SwitchRestoreFailedError,
  switchProfile,
} from "../../services/profile-switch.js";
import {
  applyProfileStashCommand,
  listProfileStashEntries,
  popProfileStashCommand,
  stashProfileCommand,
} from "../../services/profile-stash.js";
import { resolveProfileUseSelection } from "../../services/profile-use-resolve.js";
import {
  executeProjectUse,
} from "../../services/project-config-use.js";
import {
  mapProfileUseDelegationOptions,
  renderProjectUseHuman,
} from "../../services/use-command.js";
import {
  resolveSkillPackageCheckout,
  type PluginSourceConflictPolicy,
} from "../../services/skill-package-resolve.js";
import { runPluginCreateFromSourceWizard } from "../../services/wizards/plugin-create-from-source.js";
import {
  isPromptCancellationError,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import type { Plugin } from "../../types.js";
import { ui } from "../../ui/index.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCount, formatPluginLabel } from "../formatting.js";
import { configureCommandGroup } from "../help.js";
import { handlePluginInstallCommand } from "../handlers/plugin-install.js";
import { parseCommaSeparatedList } from "../handlers/parse-flags.js";
import {
  countMaterialPluginResources,
  handlePluginPublishCommand,
} from "../handlers/plugin-publish.js";
import { handlePluginShowCommand } from "../handlers/plugin-show-command.js";
import { resolvePluginMutationTarget } from "../handlers/resolve-plugin-mutation-target.js";
import { renderCliError } from "../runtime.js";
import { collectRepeatedOption, formatCommand } from "../shared.js";

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
  const installed = await handlePluginInstallCommand(selector, opts);
  if (!installed || process.exitCode) {
    return;
  }

  const installedPlugin = getPlugin(installed.pluginName);
  if (!installedPlugin || isProfilePlugin(installedPlugin)) {
    return;
  }

  ui.warn(
    `Installed plugin ${ui.theme.accent(installed.pluginName)} is not tagged as a profile.`,
  );
}

function warnProfilePublishValidation(plugin: Plugin): void {
  const refs = listAttachedPluginRefs(plugin.id);
  const materialCount = countMaterialPluginResources(plugin.id);
  if (refs.length === 0 && materialCount === 0) {
    ui.warn(
      `Profile ${ui.theme.accent(plugin.name)} has no plugin references and no material resources.`,
    );
  }

  const unresolvedLocalRefs: string[] = [];
  for (const ref of refs) {
    const local = resolvePluginSelector(
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
      `Profile ${ui.theme.accent(plugin.name)} references unpublished local plugins: ${unresolvedLocalRefs.join(", ")}`,
    );
  }
}

async function handleProfilePublishCommand(
  pluginName: string,
  opts: { org?: string; catalog?: string; account?: string; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const plugin = getPlugin(pluginName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${pluginName}`);
    return;
  }
  if (!isProfilePlugin(plugin)) {
    ui.warn(`Plugin "${plugin.name}" is not tagged as a profile.`);
  }
  warnProfilePublishValidation(plugin);
  await handlePluginPublishCommand(pluginName, undefined, opts);
}

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
export function registerProfileCommands(root: Command): void {
  const profileCmd = configureCommandGroup(
  root
    .command("profile")
    .alias("p")
    .description("Manage profile plugins and global profile switching"),
);

profileCmd
  .command("list")
  .alias("ls")
  .option("-s, --search <query>", "Filter by name, description, or tags (local and remote)")
  .option("--local-only", "List only local profile plugins")
  .option("--remote-only", "List only remote catalog profile plugins")
  .option("--account <name>", "Cloud account to use for remote listing")
  .option("--base-url <url>", "HarnessTap Cloud base URL")
  .option("--no-interactive", "Disable interactive wizards")
  .option("--interactive", "Enable interactive wizards")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List local profile plugins and remote catalog profiles")
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
      await handlePluginListCommand({
        profileMode: true,
        localPluginsProvider: listProfilePluginsCommand,
        tag: PROFILE_PLUGIN_TAG,
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
  .argument("[name]", "Profile plugin name or selector")
  .option("--format <mode>", "Output format: human or json", "human")
  .option("--show-id", "Show IDs in list-oriented human tables")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .description("Show profile plugin details, resources, and dependencies")
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
    const resolvedName = name ?? await resolvePluginMutationTarget({
      pluginName: name,
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
    handlePluginShowCommand(formatPluginLabel(payload.profile), opts, {
      active: payload.active,
    });
  });

profileCmd
  .command("status")
  .option("--harness <slugs>", "Comma-separated harness slugs (defaults to global harness preference)")
  .option("--depth <mode>", "Status scan depth: fast or full", "full")
  .option("--project <path>", "Project directory for project drift checks")
  .option("--check", "Exit with code 1 when global state is out of sync with the active profile")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show the active profile and whether global harness files are in sync")
  .action(async (opts: {
    harness?: string;
    depth?: string;
    project?: string;
    check?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const depth = opts.depth === "fast" ? "fast" : "full";
    try {
      const status = await detectGlobalProfileStatus({
        harness: opts.harness,
        depth,
        projectPath: opts.project,
      });
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

      const collisionCount = status.host_managed?.cursor?.collisions.length ?? 0;
      if (format !== "json" && collisionCount > 0) {
        ui.warn(
          `${collisionCount} Cursor host-managed skill name collision(s) with user or profile skills.`,
        );
        ui.hint(
          "Cursor built-ins live under ~/.cursor/skills-cursor/ (read-only inventory). User skills belong in ~/.cursor/skills/.",
        );
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
  .argument("[name]", "Profile plugin name or selector")
  .option("--profile <name>", "Profile key from .harnesstap/config.toml")
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
  .option("--no-pull", "Do not auto-pull missing published plugin dependencies")
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
      try {
        const selection = await resolveProfileUseSelection({
          name,
          profile: opts.profile,
          project: opts.project,
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
          format: opts.format,
        });
        if (!selection) {
          process.exitCode = 1;
          ui.danger(
            "Profile name is required. Pass a profile plugin name, --profile <key> from project config, or run interactively.",
          );
          return;
        }
        if (selection.kind === "project") {
          const result = await executeProjectUse(
            mapProfileUseDelegationOptions({ ...opts, profile: selection.profileKey }),
          );
          if (format === "json") {
            printJson(result);
            return;
          }
          renderProjectUseHuman(result);
          return;
        }
        name = selection.pluginName;
      } catch (err) {
        process.exitCode = 1;
        ui.danger(err instanceof Error ? err.message : String(err));
        return;
      }
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
      if ((payload.pulled_plugins?.length ?? 0) > 0) {
        ui.info(
          `Pulled ${payload.pulled_plugins?.length ?? 0} missing plugin dependencies:`,
        );
        for (const pulled of payload.pulled_plugins ?? []) {
          console.log(`  - ${pulled.plugin_name} (${pulled.source})`);
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

const stashCmd = profileCmd
  .command("stash")
  .option("--dry-run", "Show what would be cleared without writing")
  .option(
    "--harness <slugs>",
    "Comma-separated harness slugs (defaults to global harness preference)",
  )
  .option(
    "--on-conflict <policy>",
    "When generated files already exist: replace, skip, or prompt",
  )
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Stash untracked on-disk resources for the active profile (like git stash -u)")
  .action(async (opts: {
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    format?: string;
    noInteractive?: boolean;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflict,
      noInteractive: opts.noInteractive ?? format === "json",
    });
    try {
      const result = await stashProfileCommand({
        dryRun: opts.dryRun,
        harness: opts.harness,
        conflictPolicy,
        pull: false,
        ...(conflictPolicy === "prompt"
          ? { conflictResolver: promptMaterializationConflict }
          : {}),
      });
      if (format === "json") {
        printJson(result);
        return;
      }
      const dryPrefix = result.cleared.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Stashed ${result.entry.contents.resources.length} untracked resource${result.entry.contents.resources.length === 1 ? "" : "s"} for profile ${ui.theme.accent(result.entry.profile_name)}.`,
      );
      if ((result.cleared.removed_files?.length ?? 0) > 0) {
        ui.dim(`Removed ${result.cleared.removed_files?.length} managed file(s).`);
      }
      ui.hint(`Restore with ${formatCommand("profile stash pop")}.`);
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

stashCmd
  .command("list")
  .alias("ls")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List stashed profiles")
  .action((opts: { format?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const entries = listProfileStashEntries();
    if (format === "json") {
      printJson({ entries });
      return;
    }
    if (entries.length === 0) {
      ui.info("No stashed profiles.");
      return;
    }
    for (const [index, entry] of entries.entries()) {
      ui.info(
        `stash@{${index}}: ${ui.theme.accent(entry.profile_name)} (${entry.id})`,
      );
    }
  });

stashCmd
  .command("pop")
  .option("--dry-run", "Show what would be restored without writing")
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
  .option("--no-pull", "Do not auto-pull missing published plugin dependencies")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Restore the most recent stashed profile and remove it from the stash")
  .action(async (opts: {
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
    format?: string;
    noInteractive?: boolean;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflict,
      noInteractive: opts.noInteractive ?? format === "json",
    });
    try {
      const result = await popProfileStashCommand({
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
        printJson(result);
        return;
      }
      if (result.restored.cancelled) {
        process.exitCode = 1;
        ui.warn("Profile restore cancelled.");
        return;
      }
      const dryPrefix = result.restored.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Restored stashed profile ${ui.theme.accent(result.entry.profile_name)}.`,
      );
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

stashCmd
  .command("apply")
  .option("--dry-run", "Show what would be restored without writing")
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
  .option("--no-pull", "Do not auto-pull missing published plugin dependencies")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Restore the most recent stashed profile without removing it from the stash")
  .action(async (opts: {
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
    format?: string;
    noInteractive?: boolean;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: opts.onConflict,
      noInteractive: opts.noInteractive ?? format === "json",
    });
    try {
      const result = await applyProfileStashCommand({
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
        printJson(result);
        return;
      }
      if (result.restored.cancelled) {
        process.exitCode = 1;
        ui.warn("Profile restore cancelled.");
        return;
      }
      const dryPrefix = result.restored.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Applied stashed profile ${ui.theme.accent(result.entry.profile_name)}.`,
      );
    } catch (err) {
      process.exitCode = 1;
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

profileCmd
  .command("switch")
  .argument("<name>", "Profile plugin name or selector")
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
  .option("--no-pull", "Do not auto-pull missing published plugin dependencies")
  .option("--no-interactive", "Disable interactive prompts")
  .option("--interactive", "Enable interactive prompts")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Switch the active profile and restore the previous one on failure")
  .action(async (name: string, opts: {
    dryRun?: boolean;
    harness?: string;
    onConflict?: string;
    account?: string;
    baseUrl?: string;
    pull?: boolean;
    interactive?: boolean;
    noInteractive?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
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
      const result = await switchProfile(name, {
        apply: {
          dryRun: opts.dryRun,
          harness: opts.harness,
          pull: opts.pull,
          account: opts.account,
          baseUrl: opts.baseUrl,
          conflictPolicy,
          ...(conflictPolicy === "prompt"
            ? { conflictResolver: promptMaterializationConflict }
            : {}),
        },
      });
      if (format === "json") {
        printJson(result);
        return;
      }
      if (result.cancelled) {
        process.exitCode = 1;
        ui.warn("Profile switch cancelled.");
        return;
      }
      if (!result.ok) {
        process.exitCode = 1;
        ui.danger(`Failed to switch to profile ${ui.theme.accent(name)}: ${result.apply_error}`);
        ui.info(
          `Restored previous profile ${ui.theme.accent(result.restored.profile_name)}.`,
        );
        return;
      }
      const dryPrefix = result.apply.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
      ui.success(
        `${dryPrefix}Switched to profile ${ui.theme.accent(result.apply.profile_name)} on ${result.apply.harnesses.join(", ") || "(none)"}`,
      );
      if (result.apply.default_environment_name) {
        ui.info(`Default environment: ${result.apply.default_environment_name}`);
      }
      ui.kvBlock([
        { key: "Files", value: `${result.apply.files.length}` },
        { key: "Written", value: `${result.apply.written_files.length}` },
        { key: "Skipped", value: `${result.apply.skipped_files.length}` },
        ...(result.apply.snapshot_id
          ? [{ key: "Snapshot", value: result.apply.snapshot_id }]
          : []),
      ]);
    } catch (err) {
      process.exitCode = 1;
      if (err instanceof SwitchRestoreFailedError) {
        ui.danger(err.message);
        return;
      }
      ui.danger(err instanceof Error ? err.message : String(err));
    }
  });

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

profileCmd
  .command("delete")
  .argument("<name>", "Profile plugin name or selector")
  .option("--plugin", "Also delete the underlying plugin without prompting")
  .option("-y, --yes", "Skip the interactive plugin delete prompt")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Demote a profile plugin and optionally delete the underlying plugin")
  .action(async (name: string, opts: {
    plugin?: boolean;
    yes?: boolean;
    format?: string;
  }) => {
    const db = getDb();
    initializeSchema(db);
    const format = parseOutputFormat(opts.format);
    try {
      const demoted = deleteProfileCommand(name);
      let pluginDeleted = false;
      if (opts.plugin || format === "human") {
        pluginDeleted = await maybePromptProfilePluginDelete({
          pluginName: demoted.plugin_name,
          pluginId: demoted.plugin_id,
          format: opts.format,
          yes: opts.yes,
          deletePluginFlag: opts.plugin,
        });
      }

      if (format === "json") {
        printJson({
          ...demoted,
          plugin_deleted: pluginDeleted,
        });
        return;
      }

      ui.success(`Demoted profile ${ui.theme.accent(demoted.plugin_name)}`);
      if (demoted.was_active) {
        ui.info("Cleared active profile pointer.");
      }
      if (pluginDeleted) {
        ui.success(`Deleted plugin ${ui.theme.accent(demoted.plugin_name)}`);
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
  .command("pull")
  .argument("<selector>", "Catalog profile selector")
  .option("--as <name>", "Install as local plugin name")
  .option("--org <slug>", "Organization slug helper for short selectors")
  .option("--catalog <slug>", "Catalog slug helper for short selectors")
  .option("--version <version>", "Plugin version helper for short selectors")
  .option("--account <name>", "Cloud account name")
  .option("--base-url <url>", "Cloud base URL")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Pull a profile plugin from catalog")
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
  .argument("<name>", "Profile plugin name")
  .option("--org <slug>", "Organization slug")
  .option("--catalog <slug>", "Catalog slug")
  .option("--account <name>", "Cloud account name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a profile plugin with validation warnings")
  .action(async (name: string, opts: {
    org?: string;
    catalog?: string;
    account?: string;
    format?: string;
  }) => {
    await handleProfilePublishCommand(name, opts);
  });
}
