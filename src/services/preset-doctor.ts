import { getPreset, getPresetResources } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import { duplicateResourcesCheck } from "./preset-doctor/checks/duplicate-resources.js";
import { emptyContentCheck } from "./preset-doctor/checks/empty-content.js";
import { emptyPresetCheck } from "./preset-doctor/checks/empty-preset.js";
import { pluginMetadataCheck } from "./preset-doctor/checks/plugin-metadata.js";
import type {
  PresetDoctorCheck,
  PresetDoctorContext,
  PresetDoctorResult,
} from "./preset-doctor/preset-doctor.types.js";

const presetDoctorChecks: PresetDoctorCheck[] = [
  emptyPresetCheck,
  duplicateResourcesCheck,
  emptyContentCheck,
  pluginMetadataCheck,
];

function createPresetDoctorContext(nameOrId: string): PresetDoctorContext {
  const preset = getPreset(nameOrId);
  if (!preset) {
    throw new Error(`Preset not found: ${nameOrId}`);
  }

  return {
    preset,
    resources: getPresetResources(preset.id),
    plugins: listPresetPlugins(preset.id),
  };
}

export function listPresetDoctorChecks(): PresetDoctorCheck[] {
  return [...presetDoctorChecks];
}

export function runPresetDoctor(input: {
  nameOrId: string;
  checkIds?: string[];
}): {
  preset: string;
  valid: boolean;
  checks: string[];
  results: PresetDoctorResult[];
} {
  const context = createPresetDoctorContext(input.nameOrId);
  const requestedChecks = input.checkIds?.length
    ? new Set(input.checkIds)
    : null;
  const checks = presetDoctorChecks.filter((check) => requestedChecks?.has(check.id) ?? true);

  if (requestedChecks) {
    const knownCheckIds = new Set(presetDoctorChecks.map((check) => check.id));
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
    preset: context.preset.name,
    valid: !results.some((result) => result.severity === "error"),
    checks: checks.map((check) => check.id),
    results,
  };
}

export type {
  PresetDoctorCheck,
  PresetDoctorResult,
} from "./preset-doctor/preset-doctor.types.js";
