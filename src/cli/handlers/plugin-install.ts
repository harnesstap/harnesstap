import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  PluginAmbiguityError,
  PluginResolveError,
  resolveInstallSelector,
} from "../../services/plugin-bare-name-resolve.js";
import { installPluginFromCatalog } from "../../services/plugin-catalog-install.js";
import { formatPublishedSelector } from "../../services/plugin-selector.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export async function handlePluginInstallCommand(
  selector: string,
  opts: {
    as?: string;
    org?: string;
    catalog?: string;
    version?: string;
    account?: string;
    baseUrl?: string;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<{ pluginName: string; pluginId: string } | undefined> {
  const db = getDb();
  initializeSchema(db);

  let parsed: Awaited<ReturnType<typeof resolveInstallSelector>>;
  try {
    parsed = await resolveInstallSelector(selector, {
      org: opts.org,
      catalog: opts.catalog,
      version: opts.version,
      account: opts.account,
      baseUrl: opts.baseUrl,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
    });
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof PluginResolveError || err instanceof PluginAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return undefined;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }

  try {
    const installed = await installPluginFromCatalog(parsed, {
      as: opts.as,
      account: opts.account,
      baseUrl: opts.baseUrl,
    });
    if (parseOutputFormat(opts.format) === "json") {
      printJson({
        plugin_name: installed.pluginName,
        org_slug: parsed.org_slug,
        catalog_slug: parsed.catalog_slug,
        plugin_slug: parsed.plugin_slug,
        version: installed.version,
      });
      return { pluginName: installed.pluginName, pluginId: installed.pluginId };
    }
    const sourceLabel = formatPublishedSelector({
      org: parsed.org_slug,
      catalog: parsed.catalog_slug,
      name: parsed.plugin_slug,
    });
    ui.success(`Installed plugin ${installed.pluginName} from ${sourceLabel}`);
    return { pluginName: installed.pluginName, pluginId: installed.pluginId };
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
