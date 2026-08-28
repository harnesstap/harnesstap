import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { PROFILE_PLUGIN_TAG, isProfilePlugin } from "../../constants/profile.js";
import { getPlugin, resolvePluginSelector } from "../../models/plugin-model.js";
import { listAttachedPluginRefs } from "../../services/plugin-composition.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import { handlePluginListCommand } from "../../services/plugin-list.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
import {
  deleteProfileCommand,
  listProfilePluginsCommand,
  showProfileCommand,
  useProfileCommand,
} from "../../services/profile-commands.js";
import { detectGlobalProfileStatus } from "../../services/global-profile-drift.js";
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
  isPromptCancellationError,
} from "../../services/wizards/shared.js";
import type { Plugin } from "../../types.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatPluginLabel } from "../formatting.js";
import { configureCommandGroup } from "../help.js";
import { handlePluginInstallCommand } from "../handlers/plugin-install.js";
import {
  countMaterialPluginResources,
  handlePluginPublishCommand,
} from "../handlers/plugin-publish.js";
import { handlePluginShowCommand } from "../handlers/plugin-show-command.js";
import { resolvePluginMutationTarget } from "../handlers/resolve-plugin-mutation-target.js";
import { renderCliError } from "../runtime.js";
import { formatCommand } from "../shared.js";
import { registerProfileCreateCommand } from "../handlers/profile-create.js";
import { registerProfileParityCommands } from "./parity-register.js";

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
  .option("--profile <name>", "Profile key from apm.yml")
  .option("--project <path>", "Project directory for apm.yml discovery", ".")
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

  registerProfileCreateCommand(profileCmd);

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

  registerProfileParityCommands(profileCmd);
}
