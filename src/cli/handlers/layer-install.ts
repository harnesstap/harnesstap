import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  LayerAmbiguityError,
  LayerResolveError,
  resolveInstallSelector,
} from "../../services/layer-bare-name-resolve.js";
import { installLayerFromCatalog } from "../../services/layer-catalog-install.js";
import {
  handleLayerListCommand,
  warnLayerPullBrowseDeprecated,
} from "../../services/layer-list.js";
import { formatPublishedSelector } from "../../services/layer-selector.js";
import {
  isPromptCancellationError,
  shouldUseWizard,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export async function handleLayerInstallCommand(
  selector: string | undefined,
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
): Promise<{ layerName: string; layerId: string } | undefined> {
  const db = getDb();
  initializeSchema(db);

  if (!selector) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: parseOutputFormat(opts.format),
      missingRequiredArgs: true,
    });

    if (!canPrompt) {
      process.exitCode = 1;
      ui.danger("error: selector is required in non-interactive mode. Use: layer pull org/catalog/layer[@version]");
      return undefined;
    }

    warnLayerPullBrowseDeprecated();
    try {
      await handleLayerListCommand({
        installOnSelect: true,
        account: opts.account,
        baseUrl: opts.baseUrl,
        format: parseOutputFormat(opts.format),
        noInteractive: opts.noInteractive,
        interactive: opts.interactive,
        installContext: {
          as: opts.as,
          org: opts.org,
          catalog: opts.catalog,
          version: opts.version,
          account: opts.account,
          baseUrl: opts.baseUrl,
          format: opts.format,
          interactive: opts.interactive,
          noInteractive: opts.noInteractive,
        },
      });
    } catch (err) {
      process.exitCode = 1;
      if (isPromptCancellationError(err)) {
        return undefined;
      }
      ui.danger(err instanceof Error ? err.message : String(err));
    }
    return undefined;
  }

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
    if (err instanceof LayerResolveError || err instanceof LayerAmbiguityError) {
      ui.danger(err.message, { hints: err.hints });
      return undefined;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }

  try {
    const installed = await installLayerFromCatalog(parsed, {
      as: opts.as,
      account: opts.account,
      baseUrl: opts.baseUrl,
    });
    if (parseOutputFormat(opts.format) === "json") {
      printJson({
        layer_name: installed.layerName,
        org_slug: parsed.org_slug,
        catalog_slug: parsed.catalog_slug,
        layer_slug: parsed.layer_slug,
        version: installed.version,
      });
      return { layerName: installed.layerName, layerId: installed.layerId };
    }
    const sourceLabel = formatPublishedSelector({
      org: parsed.org_slug,
      catalog: parsed.catalog_slug,
      name: parsed.layer_slug,
    });
    ui.success(`Installed layer ${installed.layerName} from ${sourceLabel}`);
    return { layerName: installed.layerName, layerId: installed.layerId };
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}
