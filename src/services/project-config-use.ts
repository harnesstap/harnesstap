import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProfileLayer } from "../constants/profile.js";
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
import { useProfileCommand } from "./profile-commands.js";
import { maybeSyncActiveProfileBeforeSwitch } from "./profile-switch-prompt.js";
import type { ApplyProfileLayerResult } from "./profile-apply.js";
import { getActiveProfileName } from "./active-profile.js";
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
    } & ApplyProfileLayerResult);

function assertProfileLayer(layer: { name: string; tags: string[] }, context: string): void {
  if (!isProfileLayer(layer)) {
    throw new Error(`Layer "${layer.name}" is not tagged as a profile (${context})`);
  }
}

function resolveExpectedLayerName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string | undefined {
  switch (entry.source) {
    case "catalog":
    case "local": {
      return resolveLayerSelector(entry.selector!)?.name;
    }
    case "inline": {
      const inlineLayer = config.layers.find((layer) => layer.name === entry.layer);
      return inlineLayer?.name ?? entry.layer;
    }
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
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
  const dir = mkdtempSync(join(tmpdir(), "harnessdeck-project-inline-"));
  const filePath = join(dir, "inline.harnessdeck.toml");
  writeFileSync(filePath, formatTransportToml(document), "utf-8");
  return filePath;
}

function resolveProfileKey(
  config: ResolvedProjectConfig,
  profile?: string,
): string {
  if (profile) {
    return profile;
  }
  if (config.profiles.length === 1) {
    const [onlyProfile] = config.profiles;
    if (!onlyProfile) {
      throw new Error("Project config has no profiles");
    }
    return onlyProfile.name;
  }
  if (config.profiles.length === 0) {
    throw new Error("Project config has no profiles");
  }
  throw new Error(
    "multiple profiles configured; pass --profile <name> or run interactively",
  );
}

export async function resolveProjectProfileLayerName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
  options: Pick<ProjectUseOptions, "pull" | "account" | "baseUrl">,
): Promise<string> {
  const pull = options.pull ?? true;

  switch (entry.source) {
    case "catalog": {
      const selector = entry.selector!;
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
      const layer = resolveLayerSelector(entry.selector!);
      if (!layer) {
        throw new Error(`Profile layer not found locally: ${entry.selector}`);
      }
      assertProfileLayer(layer, `local profile ${entry.name}`);
      return layer.name;
    }
    case "inline": {
      const layerTable = findInlineLayerTable(config, entry.layer!);
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
  const config = findProjectConfig(options.project ?? process.cwd());
  if (!config) {
    throw new Error(
      "No project config found. Run `hd config init` to create `.harnessdeck/config.toml`.",
    );
  }

  const profileKey = resolveProfileKey(config, options.profile);
  const entry = getProfileEntry(config, profileKey);
  const environmentName = resolveProfileEnvironment(config, entry);
  const expectedLayerName = resolveExpectedLayerName(config, entry);
  if (!expectedLayerName) {
    throw new Error(`Unable to resolve layer name for profile: ${profileKey}`);
  }

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

  await importProjectConfigEnvironments(config);
  const layerName = await resolveProjectProfileLayerName(config, entry, {
    pull: options.pull ?? true,
    account: options.account,
    baseUrl: options.baseUrl,
  });

  if (environmentName) {
    useEnvironmentCommand(environmentName);
  }

  await maybeSyncActiveProfileBeforeSwitch({
    targetProfileName: layerName,
    harness: options.harness,
    yes: options.yes,
    format: options.format,
  });

  const conflictPolicy = resolveApplyConflictPolicy({
    onConflict: options.onConflict,
    noInteractive: options.format === "json",
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
