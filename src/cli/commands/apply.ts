import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { isProfilePlugin } from "../../constants/profile.js";
import { resolvePluginSelector } from "../../models/plugin-model.js";
import {
  addApplyCommandOptions,
  type ApplyCommandOpts,
} from "../../services/apply-command-options.js";
import {
  printDestination,
  resolveApplyScope,
} from "../../services/apply-scope.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  uniqueHarnessTargets,
} from "../../services/harness-targets.js";
import { resolveApplyConflictPolicy, promptMaterializationConflict } from "../../services/materialization-conflicts.js";
import { applyProfilePlugin } from "../../services/profile-apply.js";
import { withProfileApplyLock } from "../../services/profile-apply-lock.js";
import { useProfileCommand } from "../../services/profile-commands.js";
import { getHarnessPreference } from "../../models/harness.js";
import { detectPlatforms } from "../../services/scanner.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { formatCommand } from "../shared.js";
import { CriticalUnicodeError } from "../../services/unicode-scan.js";
import { handleProjectApplyCommand } from "./plugin.js";

export type ApplyCommandActionOpts = ApplyCommandOpts & {
  global?: boolean;
};

function resolveDestinationPlatforms(harnessOption?: string): string[] {
  const explicitTargets = uniqueHarnessTargets(
    parsePlatformFilter(harnessOption) ?? [],
  );
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
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

  return uniqueHarnessTargets(detectPlatforms(resolveHomeRoot()));
}

async function handleGlobalApplyCommand(
  plugins: string[],
  opts: ApplyCommandActionOpts,
): Promise<void> {
  const db = getDb();
  initializeSchema(db);

  const outputFormat = parseOutputFormat(opts.format);
  if (plugins.length === 0) {
    process.exitCode = 1;
    ui.danger("Provide exactly one plugin name for --global apply.", {
      hints: [formatCommand("apply <plugin> --global")],
    });
    return;
  }
  if (plugins.length > 1) {
    process.exitCode = 1;
    ui.danger("Global apply accepts exactly one plugin.", {
      hints: [formatCommand("apply <plugin> --global")],
    });
    return;
  }

  const selector = plugins[0];
  if (!selector) {
    process.exitCode = 1;
    ui.danger("Provide exactly one plugin name for --global apply.");
    return;
  }

  const plugin = resolvePluginSelector(selector);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${selector}`);
    return;
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: opts.onConflict,
    noInteractive: opts.noInteractive ?? outputFormat === "json",
  });
  const applyOptions = {
    dryRun: opts.dryRun,
    harness: opts.harness,
    account: opts.account,
    baseUrl: opts.baseUrl,
    conflictPolicy,
    ...(conflictPolicy === "prompt"
      ? { conflictResolver: promptMaterializationConflict }
      : {}),
    ...(opts.force ? { forceUnicode: true } : {}),
  };

  try {
    const recordActiveProfile = isProfilePlugin(plugin);
    const payload = recordActiveProfile
      ? await useProfileCommand(selector, applyOptions)
      : await withProfileApplyLock(() =>
          applyProfilePlugin(selector, {
            ...applyOptions,
            recordActiveProfile: false,
          }),
        );

    if (!recordActiveProfile && !payload.cancelled) {
      console.warn(
        ui.theme.warn(
          `Applied to machine home, but no active profile was recorded because ${plugin.name} is not a profile plugin.`,
        ),
      );
    }

    if (outputFormat === "json") {
      printJson({ scope: "global", ...payload });
      return;
    }

    if (payload.cancelled) {
      process.exitCode = 1;
      ui.warn("Apply cancelled.");
      return;
    }

    const dryPrefix = payload.dry_run ? `${ui.theme.muted("[dry run] ")} ` : "";
    ui.success(
      `${dryPrefix}Applied ${ui.theme.accent(payload.profile_name)} to ${payload.harnesses.join(", ") || "(none)"}`,
    );
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof CriticalUnicodeError) {
      ui.danger(err.message, {
        hints: [formatCommand("apply --global --force")],
      });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export async function handleApplyCommand(
  plugins: string[],
  opts: ApplyCommandActionOpts,
): Promise<void> {
  const outputFormat = parseOutputFormat(opts.format);
  const platforms = resolveDestinationPlatforms(opts.harness);
  const resolved = resolveApplyScope({
    global: opts.global,
    project: opts.project,
    platforms,
  });

  if (outputFormat === "human") {
    printDestination(resolved);
  }

  if (resolved.scope === "global") {
    await handleGlobalApplyCommand(plugins, opts);
    return;
  }

  await handleProjectApplyCommand(
    plugins as [string, ...string[]] | [],
    opts,
  );
}

export function registerApplyCommand(root: Command): void {
  const apply = root
    .command("apply")
    .argument("[plugins...]", "Plugins to apply")
    .option("--global", "Materialize into machine home instead of the project")
    .description("Resolve a plugin's dependency graph and materialize it");
  addApplyCommandOptions(apply);
  apply.action(async (plugins: string[], opts: ApplyCommandActionOpts) => {
    await handleApplyCommand(plugins, opts);
  });
}

export async function handleInstallCommand(
  extraArgs: string[],
  opts: ApplyCommandActionOpts,
): Promise<void> {
  if (extraArgs.length > 0) {
    process.exitCode = 1;
    ui.danger(
      "ht install does not take a plugin selector. It reads repo-root apm.yml.",
      {
        hints: [formatCommand("install"), formatCommand("apply <plugin>")],
      },
    );
    return;
  }

  await handleApplyCommand([], opts);
}

export function registerInstallCommand(root: Command): void {
  const install = root
    .command("install")
    .description(
      "Onboard a project from apm.yml (same as apply with no plugin selector)",
    );
  addApplyCommandOptions(install);
  install.action(async (opts: ApplyCommandActionOpts) => {
    await handleInstallCommand(install.args, opts);
  });
}
