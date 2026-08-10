import { getPlugin, listPlugins } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { ui } from "../ui/index.js";
import { formatCatalogSelectionLabel } from "../ui/catalog-list-render.js";
import type { CatalogPlugin } from "./catalog-types.js";
import { createPersistingCloudClient } from "./cloud-account-auth.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import {
  formatCanonicalPublishedSelector,
  resolvedRemotePluginFromCatalog,
} from "./plugin-selector.js";
import type { InteractivePluginListBrowseSelection } from "./wizards/interactive-plugin-list-browse.js";
import { promptForConfirmation } from "./wizards/shared.js";

export function isCatalogPluginManageable(plugin: CatalogPlugin): boolean {
  return plugin.manageable === true
    && typeof plugin.pluginId === "string"
    && typeof plugin.orgId === "string";
}

export function findLocalPluginForCatalogEntry(plugin: CatalogPlugin): Plugin | undefined {
  const matches = listPlugins().filter(
    (local) =>
      local.org_slug === plugin.orgSlug
      && local.catalog_slug === plugin.catalogSlug
      && (local.name === plugin.slug || local.name === plugin.name),
  );
  if (matches.length === 0) {
    return undefined;
  }
  return [...matches].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  )[0];
}

async function createAuthenticatedCloudClient(opts?: {
  account?: string;
  baseUrl?: string;
}) {
  const created = await createPersistingCloudClient(opts?.account);
  if (!created) {
    throw new Error("Not authenticated. Run `ht auth login` first.");
  }
  return created.client;
}

export function formatCatalogPluginManageLabel(plugin: CatalogPlugin): string {
  return formatCatalogSelectionLabel(plugin);
}

export async function deleteCatalogPlugin(
  plugin: CatalogPlugin,
  opts?: { account?: string; baseUrl?: string },
): Promise<void> {
  if (!isCatalogPluginManageable(plugin)) {
    throw new Error(
      `Catalog plugin is not manageable: ${formatCatalogPluginManageLabel(plugin)}`,
    );
  }

  const client = await createAuthenticatedCloudClient(opts);
  await client.deletePublishedPlugin({
    orgId: plugin.orgId as string,
    pluginId: plugin.pluginId as string,
  });
  ui.success(
    `Deleted catalog plugin ${ui.theme.accent(formatCatalogPluginManageLabel(plugin))}`,
  );
  ui.dim("Any local install of this plugin was not removed.");
}

export type EditCatalogPluginCompositionDeps = {
  onEditLocal: (name: string) => Promise<void>;
  onPublish: (
    pluginName: string,
    catalogSelector: string,
    opts: { account?: string },
  ) => Promise<void>;
};

export async function editCatalogPluginComposition(
  plugin: CatalogPlugin,
  selection: InteractivePluginListBrowseSelection,
  opts: EditCatalogPluginCompositionDeps & {
    account?: string;
    baseUrl?: string;
  },
): Promise<void> {
  if (!isCatalogPluginManageable(plugin)) {
    throw new Error(
      `Catalog plugin is not manageable: ${formatCatalogPluginManageLabel(plugin)}`,
    );
  }

  let localPlugin = findLocalPluginForCatalogEntry(plugin);
  if (!localPlugin) {
    const parsed = resolvedRemotePluginFromCatalog({
      org: selection.orgSlug,
      catalog: selection.catalogSlug,
      name: selection.slug,
      version: selection.version,
    });
    const installed = await installPluginFromCatalog(parsed, {
      account: opts.account,
      baseUrl: opts.baseUrl,
    });
    localPlugin = getPlugin(installed.pluginName);
    if (!localPlugin) {
      throw new Error(`Failed to load installed plugin: ${installed.pluginName}`);
    }
    ui.info(`Installed ${ui.theme.accent(installed.sourceLabel)} for editing`);
  }

  await opts.onEditLocal(localPlugin.name);

  const catalogSelector = formatCanonicalPublishedSelector({
    org: selection.orgSlug,
    catalog: selection.catalogSlug,
    name: selection.slug,
  });
  const shouldPublish = await promptForConfirmation({
    message: `Publish changes to ${catalogSelector}?`,
    default: false,
  });
  if (!shouldPublish) {
    return;
  }

  await opts.onPublish(localPlugin.name, catalogSelector, {
    account: opts.account,
  });
}
