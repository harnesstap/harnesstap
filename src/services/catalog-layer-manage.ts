import { getCloudAccount } from "../config/cloud-accounts.js";
import { getLayer, listLayers } from "../models/layer-model.js";
import type { Layer } from "../types.js";
import { ui } from "../ui/index.js";
import { formatCatalogSelectionLabel } from "../ui/catalog-list-render.js";
import type { CatalogLayer } from "./catalog-types.js";
import { createCloudClient } from "./cloud-client.js";
import { installLayerFromCatalog } from "./layer-catalog-install.js";
import {
  formatCanonicalPublishedSelector,
  resolvedRemoteLayerFromCatalog,
} from "./layer-selector.js";
import type { InteractiveLayerListBrowseSelection } from "./wizards/interactive-layer-list-browse.js";
import { promptForConfirmation } from "./wizards/shared.js";

export function isCatalogLayerManageable(layer: CatalogLayer): boolean {
  return layer.manageable === true
    && typeof layer.layerId === "string"
    && typeof layer.orgId === "string";
}

export function findLocalLayerForCatalogEntry(layer: CatalogLayer): Layer | undefined {
  const matches = listLayers().filter(
    (local) =>
      local.org_slug === layer.orgSlug
      && local.catalog_slug === layer.catalogSlug
      && (local.name === layer.slug || local.name === layer.name),
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
  const accountInfo = await getCloudAccount(opts?.account);
  const account = accountInfo.account;
  if (!account?.cloudBaseUrl || !account.accessToken) {
    throw new Error("Not authenticated. Run `hd auth login` first.");
  }
  return createCloudClient({
    baseUrl: opts?.baseUrl ?? account.cloudBaseUrl,
    token: {
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      expires_at:
        typeof account.accessTokenExpiresAt === "string"
          ? Number(account.accessTokenExpiresAt)
          : (account.accessTokenExpiresAt as number | undefined),
    },
  });
}

export function formatCatalogLayerManageLabel(layer: CatalogLayer): string {
  return formatCatalogSelectionLabel(layer);
}

export async function deleteCatalogLayer(
  layer: CatalogLayer,
  opts?: { account?: string; baseUrl?: string },
): Promise<void> {
  if (!isCatalogLayerManageable(layer)) {
    throw new Error(
      `Catalog layer is not manageable: ${formatCatalogLayerManageLabel(layer)}`,
    );
  }

  const client = await createAuthenticatedCloudClient(opts);
  await client.deletePublishedLayer({
    orgId: layer.orgId as string,
    layerId: layer.layerId as string,
  });
  ui.success(
    `Deleted catalog layer ${ui.theme.accent(formatCatalogLayerManageLabel(layer))}`,
  );
  ui.dim("Any local install of this layer was not removed.");
}

export type EditCatalogLayerCompositionDeps = {
  onEditLocal: (name: string) => Promise<void>;
  onPublish: (
    layerName: string,
    catalogSelector: string,
    opts: { account?: string },
  ) => Promise<void>;
};

export async function editCatalogLayerComposition(
  layer: CatalogLayer,
  selection: InteractiveLayerListBrowseSelection,
  opts: EditCatalogLayerCompositionDeps & {
    account?: string;
    baseUrl?: string;
  },
): Promise<void> {
  if (!isCatalogLayerManageable(layer)) {
    throw new Error(
      `Catalog layer is not manageable: ${formatCatalogLayerManageLabel(layer)}`,
    );
  }

  let localLayer = findLocalLayerForCatalogEntry(layer);
  if (!localLayer) {
    const parsed = resolvedRemoteLayerFromCatalog({
      org: selection.orgSlug,
      catalog: selection.catalogSlug,
      name: selection.slug,
      version: selection.version,
    });
    const installed = await installLayerFromCatalog(parsed, {
      account: opts.account,
      baseUrl: opts.baseUrl,
    });
    localLayer = getLayer(installed.layerName);
    if (!localLayer) {
      throw new Error(`Failed to load installed layer: ${installed.layerName}`);
    }
    ui.info(`Installed ${ui.theme.accent(installed.sourceLabel)} for editing`);
  }

  await opts.onEditLocal(localLayer.name);

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

  await opts.onPublish(localLayer.name, catalogSelector, {
    account: opts.account,
  });
}
