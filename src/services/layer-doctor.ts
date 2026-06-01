import { getLayer, getLayerResources } from "../models/layer.js";
import { listLayerPlugins } from "../models/plugin.js";
import { duplicateResourcesCheck } from "./layer-doctor/checks/duplicate-resources.js";
import { emptyContentCheck } from "./layer-doctor/checks/empty-content.js";
import { emptyLayerCheck } from "./layer-doctor/checks/empty-layer.js";
import { pluginMetadataCheck } from "./layer-doctor/checks/plugin-metadata.js";
import type {
  LayerDoctorCheck,
  LayerDoctorContext,
  LayerDoctorResult,
} from "./layer-doctor/layer-doctor.types.js";

const layerDoctorChecks: LayerDoctorCheck[] = [
  emptyLayerCheck,
  duplicateResourcesCheck,
  emptyContentCheck,
  pluginMetadataCheck,
];

function createLayerDoctorContext(nameOrId: string): LayerDoctorContext {
  const layer = getLayer(nameOrId);
  if (!layer) {
    throw new Error(`Layer not found: ${nameOrId}`);
  }

  return {
    layer,
    resources: getLayerResources(layer.id),
    plugins: listLayerPlugins(layer.id),
  };
}

export function listLayerDoctorChecks(): LayerDoctorCheck[] {
  return [...layerDoctorChecks];
}

export function runLayerDoctor(input: {
  nameOrId: string;
  checkIds?: string[];
}): {
  layer: string;
  valid: boolean;
  checks: string[];
  results: LayerDoctorResult[];
} {
  const context = createLayerDoctorContext(input.nameOrId);
  const requestedChecks = input.checkIds?.length
    ? new Set(input.checkIds)
    : null;
  const checks = layerDoctorChecks.filter((check) => requestedChecks?.has(check.id) ?? true);

  if (requestedChecks) {
    const knownCheckIds = new Set(layerDoctorChecks.map((check) => check.id));
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
    layer: context.layer.name,
    valid: !results.some((result) => result.severity === "error"),
    checks: checks.map((check) => check.id),
    results,
  };
}

export type {
  LayerDoctorCheck,
  LayerDoctorResult,
} from "./layer-doctor/layer-doctor.types.js";
