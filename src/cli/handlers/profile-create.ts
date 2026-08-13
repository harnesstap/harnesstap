import type { Command } from "commander";
import { getDb, getHarnesstapDir } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { PROFILE_PLUGIN_TAG, isProfilePlugin } from "../../constants/profile.js";
import { createPluginFromSource } from "../../services/plugin-from-source.js";
import { assertSupportedHarnessTargets } from "../../services/harness-targets.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "../../services/materialization-conflicts.js";
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

export async function handleProfileCreateCommand(
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
