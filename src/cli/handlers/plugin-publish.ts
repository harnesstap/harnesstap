import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getPlugin, getPluginResources } from "../../models/plugin-model.js";
import {
  resolveOneOffPublishTarget,
  resolvePublishTargetsForPlugin,
} from "../../services/plugin-catalog-bindings.js";
import {
  planPluginPublish,
  publishPluginToCatalogs,
  renderPublishResults,
} from "../../services/plugin-publish.js";
import { formatPublishedSelector } from "../../services/plugin-selector.js";
import {
  assertAuthored,
  PluginProvenanceError,
} from "../../services/plugin-origin.js";
import {
  assertPluginsCleanForShare,
  cutPluginVersion,
  PluginVersionError,
} from "../../services/plugin-versioning.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

function publishVersionRequiredMessage(pluginName: string, reason: string): string {
  return `${reason} Pass --version <semver> to cut a new plugin version before publishing (e.g. \`plugin publish ${pluginName} --version 1.1.0\`).`;
}

export async function handlePluginPublishCommand(
  pluginName: string,
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
  let plugin = getPlugin(pluginName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${pluginName}`);
    return;
  }

  try {
    assertAuthored(plugin.id, "publish");
    if (opts.version) {
      plugin = cutPluginVersion({ pluginId: plugin.id, newVersion: opts.version });
    } else if (plugin.dirty) {
      throw new PluginVersionError(
        "dirty_plugins",
        publishVersionRequiredMessage(
          plugin.name,
          `Plugin ${plugin.name}@${plugin.version} has unpublished edits.`,
        ),
        { dirtyPlugins: [{ name: plugin.name, version: plugin.version }] },
      );
    }

    assertPluginsCleanForShare([plugin]);

    const oneOffTargets = resolveOneOffPublishTarget({
      catalogSelector,
      org: opts.org,
      catalog: opts.catalog,
      account: opts.account,
    });
    const targets = oneOffTargets.length > 0
      ? oneOffTargets
      : resolvePublishTargetsForPlugin(plugin.id);

    const results = await publishPluginToCatalogs(plugin, targets, {
      account: opts.account,
    });

    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({
        plugin: plugin.name,
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
      renderPublishResults(plugin.name, results);
    }

    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof PluginProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    if (err instanceof PluginVersionError) {
      ui.danger(err.message);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export async function handlePluginPublishPlanCommand(
  pluginName: string,
  opts: { account?: string; format?: string },
) {
  const db = getDb();
  initializeSchema(db);
  const plugin = getPlugin(pluginName);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${pluginName}`);
    return;
  }

  try {
    assertAuthored(plugin.id, "publish");
    const targets = resolvePublishTargetsForPlugin(plugin.id);
    const plans = await planPluginPublish(plugin, targets, { account: opts.account });
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({ plugin: plugin.name, plans });
      return;
    }

    for (const plan of plans) {
      const label = formatPublishedSelector({
        org: plan.target.org,
        catalog: plan.target.catalog,
        name: plugin.name,
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
    if (err instanceof PluginProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export function countMaterialPluginResources(pluginId: string): number {
  return getPluginResources(pluginId).filter(
    (resource) => resource.type !== "plugin",
  ).length;
}
