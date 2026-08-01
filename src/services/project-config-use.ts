import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isEmptyBuiltinProfile,
  isProfileLayer,
} from "../constants/profile.js";
import { resolveLayerSelector } from "../models/layer-model.js";
import { LAYER_SCHEMA, LAYER_SCHEMA_VERSION } from "../types.js";
import { useEnvironmentCommand } from "./environment-commands.js";
import {
  formatEnvironmentToml,
  importEnvironmentToml,
} from "./environment-import-export.js";
import { detectGlobalProfileStatus } from "./global-profile-drift.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import { importFromFile } from "./layer-import.js";
import { parseLayerSelector, resolveRemoteLayerSelector } from "./layer-selector.js";
import {
  promptMaterializationConflict,
  resolveApplyConflictPolicy,
} from "./materialization-conflicts.js";
import {
  findProjectConfig,
  getProfileEntry,
  resolveProfileEnvironment,
  type ProjectProfileEntry,
  type ProjectLayerTable,
  type ResolvedProjectConfig,
} from "./project-config.js";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "./project-config-messages.js";
import { promptForProjectProfile } from "./wizards/project-use.js";
import { shouldUseWizard } from "./wizards/shared.js";
import { useProfileCommand } from "./profile-commands.js";
import { stashProfileCommand, ProfileStashError } from "./profile-stash.js";
import { maybeSyncActiveProfileBeforeSwitch } from "./profile-switch-prompt.js";
import { clearGlobalProfileApply, type ApplyProfileLayerResult } from "./profile-apply.js";
import { clearActiveProfileName, getActiveProfileName } from "./active-profile.js";
import { getGlobalActiveEnvironmentName } from "./environment-session.js";
import {
  layerExportToTomlDocument,
  parseLayerEntry,
} from "./transport/layer.js";
import { formatTransportToml } from "./transport/write.js";

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
      layer_name: string;
      environment_name?: string;
    }
  | ({
      skipped: false;
      profile_key: string;
      layer_name: string;
      environment_name?: string;
      stashed?: boolean;
      stash_id?: string;
    } & ApplyProfileLayerResult);

function assertProfileLayer(layer: { name: string; tags: string[] }, context: string): void {
  if (!isProfileLayer(layer)) {
    throw new Error(`Layer "${layer.name}" is not tagged as a profile (${context})`);
  }
}

function resolveLayerNameFromSelector(selector: string): string {
  const existing = resolveLayerSelector(selector);
  if (existing) {
    return existing.name;
  }
  return parseLayerSelector(selector).name;
}

export function resolveExpectedLayerName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  switch (entry.source) {
    case "catalog":
    case "local": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Profile ${entry.name} is missing a layer selector.`);
      }
      return resolveLayerNameFromSelector(selector);
    }
    case "inline": {
      const layerKey = entry.layer;
      if (!layerKey) {
        throw new Error(`Inline profile ${entry.name} is missing a layer reference.`);
      }
      const inlineLayer = config.layers.find((layer) => layer.name === layerKey);
      return inlineLayer?.name ?? layerKey;
    }
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function resolvePreviewLayerName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  return resolveExpectedLayerName(config, entry);
}

function findInlineLayerTable(
  config: ResolvedProjectConfig,
  layerKey: string,
): ProjectLayerTable {
  const layer = config.layers.find((entry) => entry.name === layerKey);
  if (!layer) {
    throw new Error(`Inline profile references unknown layer: ${layerKey}`);
  }
  return layer;
}

function writeInlineLayerImportFile(layerTable: ProjectLayerTable): string {
  const layerEntry = parseLayerEntry(layerTable);
  const document = layerExportToTomlDocument({
    $schema: LAYER_SCHEMA,
    version: LAYER_SCHEMA_VERSION,
    layers: [layerEntry],
    embedded_plugins: [],
  });
  const dir = mkdtempSync(join(tmpdir(), "harnesstap-project-inline-"));
  const filePath = join(dir, "inline.harnesstap.toml");
  writeFileSync(filePath, formatTransportToml(document), "utf-8");
  return filePath;
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

export async function resolveProjectProfileLayerName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
  options: Pick<ProjectUseOptions, "pull" | "account" | "baseUrl">,
): Promise<string> {
  const pull = options.pull ?? true;

  switch (entry.source) {
    case "catalog": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Catalog profile ${entry.name} is missing a layer selector.`);
      }
      const existing = resolveLayerSelector(selector);
      if (existing) {
        assertProfileLayer(existing, `catalog profile ${entry.name}`);
        return existing.name;
      }
      if (!pull) {
        throw new Error(
          `Profile layer not found locally: ${selector}. Re-run with pull enabled or install the layer first.`,
        );
      }

      const parsed = parseLayerSelector(selector);
      if (parsed.scope === "published") {
        const remote = resolveRemoteLayerSelector(selector, {});
        const installed = await installLayerFromCatalog(remote, {
          account: options.account,
          baseUrl: options.baseUrl,
        });
        const layer = resolveLayerSelector(installed.layerName);
        if (!layer) {
          throw new Error(`Layer not found after catalog install: ${installed.layerName}`);
        }
        assertProfileLayer(layer, `catalog profile ${entry.name}`);
        return layer.name;
      }

      throw new Error(`Profile layer not found locally: ${selector}`);
    }
    case "local": {
      const selector = entry.selector;
      if (!selector) {
        throw new Error(`Local profile ${entry.name} is missing a layer selector.`);
      }
      const layer = resolveLayerSelector(selector);
      if (!layer) {
        throw new Error(`Profile layer not found locally: ${selector}`);
      }
      assertProfileLayer(layer, `local profile ${entry.name}`);
      return layer.name;
    }
    case "inline": {
      const layerKey = entry.layer;
      if (!layerKey) {
        throw new Error(`Inline profile ${entry.name} is missing a layer reference.`);
      }
      const layerTable = findInlineLayerTable(config, layerKey);
      const tempPath = writeInlineLayerImportFile(layerTable);
      const imported = importFromFile(tempPath);
      assertProfileLayer(imported.layer, `inline profile ${entry.name}`);
      return imported.layer.name;
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
  layerName: string;
  environmentName?: string;
  force?: boolean;
  harness?: string;
}): Promise<boolean> {
  if (input.force) {
    return false;
  }

  const activeProfile = getActiveProfileName();
  if (activeProfile !== input.layerName) {
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
      layer_name: cleared.profile_name,
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
  const expectedLayerName = resolveExpectedLayerName(config, entry);
  const dryRun = options.dryRun === true;

  if (
    await shouldSkipProjectUse({
      layerName: expectedLayerName,
      environmentName,
      force: options.force,
      harness: options.harness,
    })
  ) {
    return {
      skipped: true,
      profile_key: profileKey,
      layer_name: expectedLayerName,
      ...(environmentName ? { environment_name: environmentName } : {}),
    };
  }

  if (!dryRun) {
    await importProjectConfigEnvironments(config);
  }

  const layerName = dryRun
    ? resolvePreviewLayerName(config, entry)
    : await resolveProjectProfileLayerName(config, entry, {
        pull: options.pull ?? true,
        account: options.account,
        baseUrl: options.baseUrl,
      });

  if (environmentName && !dryRun) {
    useEnvironmentCommand(environmentName);
  }

  if (!dryRun) {
    await maybeSyncActiveProfileBeforeSwitch({
      targetProfileName: layerName,
      harness: options.harness,
      yes: options.yes,
      format: options.format,
    });
  }

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: options.onConflict,
    noInteractive: options.noInteractive ?? options.format === "json",
  });
  const applied = await useProfileCommand(layerName, {
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
    layer_name: layerName,
    ...(environmentName ? { environment_name: environmentName } : {}),
    ...applied,
  };
}
