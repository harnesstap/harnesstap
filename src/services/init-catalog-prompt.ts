import { listPlugins } from "../models/plugin-component.js";
import { formatCatalogScopeLabel, resolveCatalogScope } from "../config/catalog.js";
import { listLayersInScope } from "./catalog-client.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import { resolveRemoteLayerSelector } from "./layer-selector.js";
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
  if (listPlugins().length > 0) {
    return;
  }

  const choice = await promptForChoice({
    message: "Browse public catalog layers now?",
    choices: [
      { name: "Yes — install a layer into the local library", value: "yes" as const },
      { name: "No — I'll use layer search / project apply later", value: "no" as const },
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

  const parsed = resolveRemoteLayerSelector(selected.selector, {
    org: selected.orgSlug,
    catalog: selected.catalogSlug,
    version: selected.version ?? undefined,
  });
  const installed = await installLayerFromCatalog(parsed, {});

  ui.success(
    `Installed layer ${ui.theme.accent(installed.layerName)} from catalog (${installed.sourceLabel})`,
  );
  ui.hint(`Apply it with: hd project apply ${installed.layerName}`);
}
