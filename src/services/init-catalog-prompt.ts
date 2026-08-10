import { listPlugins } from "../models/plugin-model.js";
import { formatCatalogScopeLabel, resolveCatalogScope } from "../config/catalog.js";
import { listPluginsInScope } from "./catalog-client.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import { resolvedRemotePluginFromCatalog } from "./plugin-selector.js";
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
    message: "Browse public catalog plugins now?",
    choices: [
      { name: "Yes — install a plugin into the local library", value: "yes" as const },
      { name: "No — I'll use plugin list / plugin apply later", value: "no" as const },
    ],
  });

  if (choice === "no") {
    return;
  }

  const scope = resolveCatalogScope();
  const selected = await runInteractiveCatalogBrowser({
    message: "Select a catalog plugin to install",
    scopeLabel: formatCatalogScopeLabel(scope),
    listPlugins: ({ q, limit }) => listPluginsInScope({ q, limit, sort: "updated" }),
  });

  const parsed = resolvedRemotePluginFromCatalog({
    org: selected.orgSlug,
    catalog: selected.catalogSlug,
    name: selected.slug,
    version: selected.version,
  });
  const installed = await installPluginFromCatalog(parsed, {});

  ui.success(
    `Installed plugin ${ui.theme.accent(installed.pluginName)} from catalog (${installed.sourceLabel})`,
  );
  ui.hint(`Apply it with: ht plugin apply ${installed.pluginName}`);
}
