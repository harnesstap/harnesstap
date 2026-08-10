import { getPlugin, getPluginResources } from "../models/plugin-model.js";
import { listDependencies } from "./plugin-dependency.js";
import { duplicateResourcesCheck } from "./plugin-doctor/checks/duplicate-resources.js";
import { emptyContentCheck } from "./plugin-doctor/checks/empty-content.js";
import { emptyPluginCheck } from "./plugin-doctor/checks/empty-plugin.js";
import { pluginMetadataCheck } from "./plugin-doctor/checks/plugin-metadata.js";
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
];

function createPluginDoctorContext(nameOrId: string): PluginDoctorContext {
  const plugin = getPlugin(nameOrId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${nameOrId}`);
  }

  return {
    plugin,
    resources: getPluginResources(plugin.id),
    plugins: listDependencies(plugin.id),
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
  };
}

export type {
  PluginDoctorCheck,
  PluginDoctorResult,
} from "./plugin-doctor/plugin-doctor.types.js";
