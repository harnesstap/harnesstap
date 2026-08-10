import { listLayers } from "../models/plugin-model.js";
import { formatCatalogScopeLabel, resolveCatalogScope } from "../config/catalog.js";
import { listLayersInScope } from "./catalog-client.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import { resolvedRemoteLayerFromCatalog } from "./layer-selector.js";
import { runInteractiveCatalogBrowser } from "./wizards/interactive-catalog-browser.js";
import { promptForChoice } from "./wizards/shared.js";
import { ui } from "../ui/index.js";

export async function maybePromptInitCatalogInstall(input: {
  interactive: boolean;
  noInteractive?: boolean;
  format: "human" | "json";
}): Promise<void> {
  if (input.format !== "human" || !input.interactive) {
    return;
  }
  if (listLayers().length > 0) {
    return;
  }

  const choice = await promptForChoice({
    message: "Browse public catalog layers now?",
    choices: [
      { name: "Yes — install a layer into the local library", value: "yes" as const },
      { name: "No — I'll use layer list / layer apply later", value: "no" as const },
    ],
  });

  if (choice === "no") {
    return;
  }

  const scope = resolveCatalogScope();
  const selected = await runInteractiveCatalogBrowser({
    message: "Select a catalog layer to install",
    scopeLabel: formatCatalogScopeLabel(scope),
    listLayers: ({ q, limit }) => listLayersInScope({ q, limit, sort: "updated" }),
  });

  const parsed = resolvedRemoteLayerFromCatalog({
    org: selected.orgSlug,
    catalog: selected.catalogSlug,
    name: selected.slug,
    version: selected.version,
  });
  const installed = await installLayerFromCatalog(parsed, {});

  ui.success(
    `Installed layer ${ui.theme.accent(installed.layerName)} from catalog (${installed.sourceLabel})`,
  );
  ui.hint(`Apply it with: ht layer apply ${installed.layerName}`);
}
