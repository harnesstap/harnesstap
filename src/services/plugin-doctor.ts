import { getPlugin } from "../models/plugin-model.js";
import {
  diagnoseParsedPackage,
  type PackageImportDiagnostics,
  type PackageResourceCount,
} from "./agent-plugins/import-diagnostics.js";
import { parseApPackageFiles } from "./agent-plugins/import.js";
import { recordedPluginInstallRoot } from "./agent-plugins/install-root.js";
import { readContainedPackageFiles } from "./agent-plugins/spec-load.js";
import { MATERIAL_RESOURCE_TYPES } from "../types.js";
import { ensureUpstreamPluginResources } from "./plugin-package-hydrate.js";
import { dependenciesFromResources } from "./plugin-dependency.js";
import { duplicateResourcesCheck } from "./plugin-doctor/checks/duplicate-resources.js";
import { emptyContentCheck } from "./plugin-doctor/checks/empty-content.js";
import { emptyPluginCheck } from "./plugin-doctor/checks/empty-plugin.js";
import { pluginMetadataCheck } from "./plugin-doctor/checks/plugin-metadata.js";
import { skippedFilesCheck } from "./plugin-doctor/checks/skipped-files.js";
import type {
  PluginDoctorCheck,
  PluginDoctorContext,
  PluginDoctorResult,
} from "./plugin-doctor/plugin-doctor.types.js";

// Plugin/component-bundle checks only. Hybrid deck repos (canonical
// `.harnesstap/deck.json` plus generated Claude manifests) should use
// `runDeckDoctor()` in `./deck-doctor.ts`.

const pluginDoctorChecks: PluginDoctorCheck[] = [
  emptyPluginCheck,
  duplicateResourcesCheck,
  emptyContentCheck,
  pluginMetadataCheck,
  skippedFilesCheck,
];

/**
 * Re-read the package HarnessTap installed for this name and version and
 * compare it with the library rows. Plugins created in the library have no
 * package, and an unreadable package is left to the other checks.
 */
function packageDiagnostics(
  plugin: { name: string; version: string },
  resources: readonly { type: string }[],
): PackageImportDiagnostics | undefined {
  const root = recordedPluginInstallRoot(plugin.name, plugin.version);
  if (!root) return undefined;
  try {
    const parsed = parseApPackageFiles(readContainedPackageFiles(root), { root });
    return diagnoseParsedPackage(
      parsed,
      resources.map((resource) => resource.type),
    );
  } catch {
    return undefined;
  }
}

function createPluginDoctorContext(nameOrId: string): PluginDoctorContext {
  const plugin = getPlugin(nameOrId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${nameOrId}`);
  }

  const resources = ensureUpstreamPluginResources(plugin);
  const diagnostics = packageDiagnostics(plugin, resources);
  return {
    plugin,
    resources,
    plugins: dependenciesFromResources(resources),
    ...(diagnostics ? { packageDiagnostics: diagnostics } : {}),
  };
}

export function listPluginDoctorChecks(): PluginDoctorCheck[] {
  return [...pluginDoctorChecks];
}

export function runPluginDoctor(input: {
  nameOrId: string;
  checkIds?: string[];
}): {
  plugin: string;
  valid: boolean;
  checks: string[];
  results: PluginDoctorResult[];
  /**
   * Per type: library resources versus what the installed package holds.
   * Without a package, discovered equals imported.
   */
  resource_counts: PackageResourceCount[];
} {
  const context = createPluginDoctorContext(input.nameOrId);
  const requestedChecks = input.checkIds?.length
    ? new Set(input.checkIds)
    : null;
  const checks = pluginDoctorChecks.filter((check) => requestedChecks?.has(check.id) ?? true);

  if (requestedChecks) {
    const knownCheckIds = new Set(pluginDoctorChecks.map((check) => check.id));
    for (const checkId of requestedChecks) {
      if (!knownCheckIds.has(checkId)) {
        throw new Error(`Unknown doctor check: ${checkId}`);
      }
    }
  }

  const results = checks.flatMap((check) =>
    check.run(context).map((result) => ({
      check: check.id,
      ...result,
    })),
  );

  return {
    plugin: context.plugin.name,
    valid: !results.some((result) => result.severity === "error"),
    checks: checks.map((check) => check.id),
    results,
    resource_counts: context.packageDiagnostics?.counts ?? libraryCounts(context.resources),
  };
}

function libraryCounts(resources: readonly { type: string }[]): PackageResourceCount[] {
  return [...MATERIAL_RESOURCE_TYPES, "plugin" as const].flatMap((type) => {
    const count = resources.filter((resource) => resource.type === type).length;
    return count > 0 ? [{ type, discovered: count, imported: count }] : [];
  });
}

export type {
  PluginDoctorCheck,
  PluginDoctorResult,
} from "./plugin-doctor/plugin-doctor.types.js";
