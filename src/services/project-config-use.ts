import {
  isEmptyBuiltinProfile,
  isProfilePlugin,
} from "../constants/profile.js";
import {
  addResourceToPlugin,
  createPlugin,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import {
  normalizeResourceInput,
  upsertResource,
} from "../models/resource.js";
import type { ClaudePluginConfig, ResourceType } from "../types.js";
import { useEnvironmentCommand } from "./environment-commands.js";
import {
  formatEnvironmentToml,
  importEnvironmentToml,
} from "./environment-import-export.js";
import { detectGlobalProfileStatus } from "./global-profile-drift.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import { parsePluginSelector, resolveRemotePluginSelector } from "./plugin-selector.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "./materialization-conflicts.js";
import {
  findProjectConfig,
  getProfileEntry,
  resolveProfileEnvironment,
  type ProjectProfileEntry,
  type ProjectPluginTable,
  type ResolvedProjectConfig,
} from "./project-config.js";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "./project-config-messages.js";
import { promptForProjectProfile } from "./wizards/project-use.js";
import { shouldUseWizard } from "./wizards/shared.js";
import { useProfileCommand } from "./profile-commands.js";
import { stashProfileCommand, ProfileStashError } from "./profile-stash.js";
import { maybeSyncActiveProfileBeforeSwitch } from "./profile-switch-prompt.js";
import { clearGlobalProfileApply, type ApplyProfilePluginResult } from "./profile-apply.js";
import { clearActiveProfileName, getActiveProfileName } from "./active-profile.js";
import { getGlobalActiveEnvironmentName } from "./environment-session.js";

export interface ProjectUseOptions {
  profile?: string;
  project?: string;
  dryRun?: boolean;
  force?: boolean;
  pull?: boolean;
  harness?: string;
  account?: string;
  baseUrl?: string;
  onConflict?: string;
  format?: string;
  yes?: boolean;
  interactive?: boolean;
  noInteractive?: boolean;
}

export type ProjectUseResult =
  | {
      skipped: true;
      profile_key: string;
      plugin_name: string;
      environment_name?: string;
    }
  | ({
      skipped: false;
      profile_key: string;
      plugin_name: string;
      environment_name?: string;
      stashed?: boolean;
      stash_id?: string;
    } & ApplyProfilePluginResult);

function assertProfilePlugin(plugin: { name: string; tags: string[] }, context: string): void {
  if (!isProfilePlugin(plugin)) {
    throw new Error(`Plugin "${plugin.name}" is not tagged as a profile (${context})`);
  }
}

function resolvePluginNameFromSelector(selector: string): string {
  const existing = resolvePluginSelector(selector);
  if (existing) {
    return existing.name;
  }
  return parsePluginSelector(selector).name;
}

export function resolveExpectedPluginName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  switch (entry.source) {
    case "catalog":
    case "local": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Profile ${entry.name} is missing a plugin selector.`);
      }
      return resolvePluginNameFromSelector(selector);
    }
    case "inline": {
      const pluginKey = entry.plugin;
      if (!pluginKey) {
        throw new Error(`Inline profile ${entry.name} is missing a plugin reference.`);
      }
      const inlinePlugin = config.plugins.find((plugin) => plugin.name === pluginKey);
      return inlinePlugin?.name ?? pluginKey;
    }
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function resolvePreviewPluginName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  return resolveExpectedPluginName(config, entry);
}

function findInlinePluginTable(
  config: ResolvedProjectConfig,
  pluginKey: string,
): ProjectPluginTable {
  const plugin = config.plugins.find((entry) => entry.name === pluginKey);
  if (!plugin) {
    throw new Error(`Inline profile references unknown plugin: ${pluginKey}`);
  }
  return plugin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function importInlinePluginTable(pluginTable: ProjectPluginTable) {
  const resourcesRaw = Array.isArray(pluginTable.resources) ? pluginTable.resources : [];
  const plugin = createPlugin({
    name: pluginTable.name,
    version: typeof pluginTable.version === "string" ? pluginTable.version : "1.0.0",
    description: typeof pluginTable.description === "string" ? pluginTable.description : "",
    tags: Array.isArray(pluginTable.tags) ? pluginTable.tags.map(String) : [],
    ...(isRecord(pluginTable.claude)
      ? { claude: pluginTable.claude as ClaudePluginConfig }
      : {}),
  });

  for (const raw of resourcesRaw) {
    if (!isRecord(raw)) continue;
    const metadata = isRecord(raw.metadata)
      ? raw.metadata
      : typeof raw.metadata_json === "string"
        ? (JSON.parse(raw.metadata_json) as Record<string, unknown>)
        : {};
    const upserted = upsertResource(
      normalizeResourceInput({
        type: String(raw.type ?? "") as ResourceType,
        name: String(raw.name ?? ""),
        description: String(raw.description ?? ""),
        content: String(raw.content ?? ""),
        metadata,
        source: `project-inline:${pluginTable.name}`,
        namespace: String(raw.namespace ?? ""),
        origin_kind: (raw.origin_kind ?? "manual") as "manual",
        origin_ref: String(raw.origin_ref ?? ""),
      }),
      { policy: "overwrite" },
    );
    if (upserted.action === "skipped") {
      throw new Error(`Failed to import inline resource: ${String(raw.type)}:${String(raw.name)}`);
    }
    addResourceToPlugin(plugin.id, upserted.resource.id);
  }

  return plugin;
}

export async function resolveProjectProfileKey(
  config: ResolvedProjectConfig,
  options: Pick<ProjectUseOptions, "profile" | "format" | "interactive" | "noInteractive">,
): Promise<string> {
  if (options.profile) {
    getProfileEntry(config, options.profile);
    return options.profile;
  }

  if (config.profiles.length === 0) {
    throw new Error("Project config has no profiles");
  }

  if (config.profiles.length === 1) {
    const [onlyProfile] = config.profiles;
    if (!onlyProfile) {
      throw new Error("Project config has no profiles");
    }
    return onlyProfile.name;
  }

  if (
    shouldUseWizard({
      interactive: options.interactive,
      noInteractive: options.noInteractive,
      format: options.format,
      missingRequiredArgs: !options.profile,
    })
  ) {
    return promptForProjectProfile(config);
  }

  throw new Error("multiple profiles configured; pass --profile <name>");
}

export async function resolveProjectProfilePluginName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
  options: Pick<ProjectUseOptions, "pull" | "account" | "baseUrl">,
): Promise<string> {
  const pull = options.pull ?? true;

  switch (entry.source) {
    case "catalog": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Catalog profile ${entry.name} is missing a plugin selector.`);
      }
      const existing = resolvePluginSelector(selector);
      if (existing) {
        assertProfilePlugin(existing, `catalog profile ${entry.name}`);
        return existing.name;
      }
      if (!pull) {
        throw new Error(
          `Profile plugin not found locally: ${selector}. Re-run with pull enabled or install the plugin first.`,
        );
      }

      const parsed = parsePluginSelector(selector);
      if (parsed.scope === "published") {
        const remote = resolveRemotePluginSelector(selector, {});
        const installed = await installPluginFromCatalog(remote, {
          account: options.account,
          baseUrl: options.baseUrl,
        });
        const plugin = resolvePluginSelector(installed.pluginName);
        if (!plugin) {
          throw new Error(`Plugin not found after catalog install: ${installed.pluginName}`);
        }
        assertProfilePlugin(plugin, `catalog profile ${entry.name}`);
        return plugin.name;
      }

      throw new Error(`Profile plugin not found locally: ${selector}`);
    }
    case "local": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Local profile ${entry.name} is missing a plugin selector.`);
      }
      const plugin = resolvePluginSelector(selector);
      if (!plugin) {
        throw new Error(`Profile plugin not found locally: ${selector}`);
      }
      assertProfilePlugin(plugin, `local profile ${entry.name}`);
      return plugin.name;
    }
    case "inline": {
      const pluginKey = entry.plugin;
      if (!pluginKey) {
        throw new Error(`Inline profile ${entry.name} is missing a plugin reference.`);
      }
      const pluginTable = findInlinePluginTable(config, pluginKey);
      const imported = importInlinePluginTable(pluginTable);
      assertProfilePlugin(imported, `inline profile ${entry.name}`);
      return imported.name;
    }
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

export async function importProjectConfigEnvironments(
  config: ResolvedProjectConfig,
): Promise<void> {
  for (const environment of config.environments) {
    importEnvironmentToml(formatEnvironmentToml(environment), {
      createIfMissing: true,
    });
  }
}

export async function shouldSkipProjectUse(input: {
  pluginName: string;
  environmentName?: string;
  force?: boolean;
  harness?: string;
}): Promise<boolean> {
  if (input.force) {
    return false;
  }

  const activeProfile = getActiveProfileName();
  if (activeProfile !== input.pluginName) {
    return false;
  }

  const activeEnvironment = getGlobalActiveEnvironmentName();
  const environmentMatches =
    input.environmentName === undefined
      ? activeEnvironment === undefined
      : activeEnvironment === input.environmentName;
  if (!environmentMatches) {
    return false;
  }

  const status = await detectGlobalProfileStatus({ harness: input.harness });
  return (
    (!status.has_drift && status.stack_in_sync) ||
    (status.applied && !status.has_drift)
  );
}

export async function executeProjectUse(
  options: ProjectUseOptions = {},
): Promise<ProjectUseResult> {
  if (options.profile && isEmptyBuiltinProfile(options.profile)) {
    const conflictPolicy = resolveApplyConflictPolicy({
      onConflict: options.onConflict,
      noInteractive: options.noInteractive ?? options.format === "json",
    });
    let stashed: Awaited<ReturnType<typeof stashProfileCommand>> | undefined;
    try {
      stashed = await stashProfileCommand({
        harness: options.harness,
        dryRun: options.dryRun,
        conflictPolicy,
        pull: false,
        ...(conflictPolicy === "prompt"
          ? { conflictResolver: promptMaterializationConflict }
          : {}),
      });
    } catch (error) {
      if (!(error instanceof ProfileStashError)) {
        throw error;
      }
    }
    const cleared = await clearGlobalProfileApply({
      harness: options.harness,
      dryRun: options.dryRun,
      conflictPolicy,
      pull: false,
      ...(conflictPolicy === "prompt"
        ? { conflictResolver: promptMaterializationConflict }
        : {}),
    });
    if (!options.dryRun) {
      clearActiveProfileName();
    }
    return {
      skipped: false,
      profile_key: stashed?.entry.profile_name ?? getActiveProfileName() ?? "empty",
      plugin_name: cleared.profile_name,
      stashed: Boolean(stashed),
      ...(stashed ? { stash_id: stashed.entry.id } : {}),
      ...cleared,
    };
  }

  const config = findProjectConfig(options.project ?? process.cwd());
  if (!config) {
    throw new Error(MISSING_PROJECT_CONFIG_MESSAGE);
  }

  const profileKey = await resolveProjectProfileKey(config, {
    profile: options.profile,
    format: options.format,
    interactive: options.interactive,
    noInteractive: options.noInteractive,
  });
  const entry = getProfileEntry(config, profileKey);
  const environmentName = resolveProfileEnvironment(config, entry);
  const expectedPluginName = resolveExpectedPluginName(config, entry);
  const dryRun = options.dryRun === true;

  if (
    await shouldSkipProjectUse({
      pluginName: expectedPluginName,
      environmentName,
      force: options.force,
      harness: options.harness,
    })
  ) {
    return {
      skipped: true,
      profile_key: profileKey,
      plugin_name: expectedPluginName,
      ...(environmentName ? { environment_name: environmentName } : {}),
    };
  }

  if (!dryRun) {
    await importProjectConfigEnvironments(config);
  }

  const pluginName = dryRun
    ? resolvePreviewPluginName(config, entry)
    : await resolveProjectProfilePluginName(config, entry, {
        pull: options.pull ?? true,
        account: options.account,
        baseUrl: options.baseUrl,
      });

  if (environmentName && !dryRun) {
    useEnvironmentCommand(environmentName);
  }

  if (!dryRun) {
    await maybeSyncActiveProfileBeforeSwitch({
      targetProfileName: pluginName,
      harness: options.harness,
      yes: options.yes,
      format: options.format,
    });
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: options.onConflict,
    noInteractive: options.noInteractive ?? options.format === "json",
  });
  const applied = await useProfileCommand(pluginName, {
    harness: options.harness,
    dryRun: options.dryRun,
    pull: options.pull ?? true,
    account: options.account,
    baseUrl: options.baseUrl,
    conflictPolicy,
    ...(conflictPolicy === "prompt"
      ? { conflictResolver: promptMaterializationConflict }
      : {}),
  });

  return {
    skipped: false,
    profile_key: profileKey,
    plugin_name: pluginName,
    ...(environmentName ? { environment_name: environmentName } : {}),
    ...applied,
  };
}
