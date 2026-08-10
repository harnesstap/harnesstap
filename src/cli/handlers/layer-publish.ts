import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getLayer, getLayerResources } from "../../models/plugin-model.js";
import {
  resolveOneOffPublishTarget,
  resolvePublishTargetsForLayer,
} from "../../services/layer-catalog-bindings.js";
import {
  planLayerPublish,
  publishLayerToCatalogs,
  renderPublishResults,
} from "../../services/layer-publish.js";
import { formatPublishedSelector } from "../../services/layer-selector.js";
import {
  assertAuthored,
  LayerProvenanceError,
} from "../../services/layer-origin.js";
import {
  assertLayersCleanForShare,
  cutLayerVersion,
  LayerVersionError,
} from "../../services/layer-versioning.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

function publishVersionRequiredMessage(layerName: string, reason: string): string {
  return `${reason} Pass --version <semver> to cut a new layer version before publishing (e.g. \`layer publish ${layerName} --version 1.1.0\`).`;
}

export async function handleLayerPublishCommand(
  layerName: string,
  catalogSelector: string | undefined,
  opts: {
    org?: string;
    catalog?: string;
    account?: string;
    format?: string;
    version?: string;
  },
) {
  const db = getDb();
  initializeSchema(db);
  let layer = getLayer(layerName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerName}`);
    return;
  }

  try {
    assertAuthored(layer.id, "publish");
    if (opts.version) {
      layer = cutLayerVersion({ layerId: layer.id, newVersion: opts.version });
    } else if (layer.dirty) {
      throw new LayerVersionError(
        "dirty_layers",
        publishVersionRequiredMessage(
          layer.name,
          `Layer ${layer.name}@${layer.version} has unpublished edits.`,
        ),
        { dirtyLayers: [{ name: layer.name, version: layer.version }] },
      );
    }

    assertLayersCleanForShare([layer]);

    const oneOffTargets = resolveOneOffPublishTarget({
      catalogSelector,
      org: opts.org,
      catalog: opts.catalog,
      account: opts.account,
    });
    const targets = oneOffTargets.length > 0
      ? oneOffTargets
      : resolvePublishTargetsForLayer(layer.id);

    const results = await publishLayerToCatalogs(layer, targets, {
      account: opts.account,
    });

    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        layer: layer.name,
        results: results.map((result) => ({
          org: result.target.org,
          catalog: result.target.catalog,
          account: result.target.account,
          ok: result.ok,
          version: result.version,
          error: result.error,
        })),
      });
    } else {
      renderPublishResults(layer.name, results);
    }

    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof LayerProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    if (err instanceof LayerVersionError) {
      ui.danger(err.message);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export async function handleLayerPublishPlanCommand(
  layerName: string,
  opts: { account?: string; format?: string },
) {
  const db = getDb();
  initializeSchema(db);
  const layer = getLayer(layerName);
  if (!layer) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${layerName}`);
    return;
  }

  try {
    assertAuthored(layer.id, "publish");
    const targets = resolvePublishTargetsForLayer(layer.id);
    const plans = await planLayerPublish(layer, targets, { account: opts.account });
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({ layer: layer.name, plans });
      return;
    }

    for (const plan of plans) {
      const label = formatPublishedSelector({
        org: plan.target.org,
        catalog: plan.target.catalog,
        name: layer.name,
      });
      if (plan.ok) {
        const accountLabel = plan.account ? ` (account: ${plan.account})` : "";
        const versionLabel = plan.nextVersion ? ` → ${plan.nextVersion}` : "";
        console.log(`${label}${accountLabel}${versionLabel}`);
      } else {
        ui.danger(`${label}: ${plan.error ?? "unavailable"}`);
      }
    }
    if (plans.some((plan) => !plan.ok)) {
      process.exitCode = 1;
    }
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof LayerProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export function countMaterialLayerResources(layerId: string): number {
  return getLayerResources(layerId).filter(
    (resource) => resource.type !== "plugin",
  ).length;
}
