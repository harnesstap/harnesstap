import { getCloudAccount } from "../config/cloud-accounts.js";
import type { RegisteredCatalog } from "../config/catalog.js";
import { formatPublishCatalogSelector } from "../config/catalog.js";
import { exportLayer } from "./layer-export.js";
import { formatLayerExportToml } from "./transport/layer.js";
import { updateLayerPublishedIdentity } from "../models/plugin-model.js";
import type { Layer } from "../types.js";
import type { CloudClient } from "./cloud-client.js";
import { createPersistingCloudClient } from "./cloud-account-auth.js";
import { formatPublishedSelector } from "./layer-selector.js";
import { ui } from "../ui/index.js";

export interface PublishTargetResult {
  target: RegisteredCatalog;
  ok: boolean;
  version?: string;
  error?: string;
}

async function createCloudClientForTarget(
  target: RegisteredCatalog,
  accountOverride?: string,
): Promise<CloudClient | undefined> {
  const accountName = accountOverride ?? target.account;
  const created = await createPersistingCloudClient(accountName);
  return created?.client;
}

export async function publishLayerToCatalogs(
  layer: Layer,
  targets: RegisteredCatalog[],
  opts?: { account?: string },
): Promise<PublishTargetResult[]> {
  const layerExport = exportLayer(layer.id);
  const layerExportToml = formatLayerExportToml(layerExport);
  const results: PublishTargetResult[] = [];
  let firstSuccess: { org_slug: string; catalog_slug: string; version?: string } | undefined;

  for (const target of targets) {
    const label = formatPublishCatalogSelector(target);
    try {
      const client = await createCloudClientForTarget(target, opts?.account);
      if (!client) {
        results.push({
          target,
          ok: false,
          error: `No cloud account configured for ${label}. Use \`auth login\` or pass --account.`,
        });
        continue;
      }

      const resp = await client.publishLayerExport(
        {
          layer_name: layer.name,
          org_slug: target.org,
          catalog_slug: target.catalog,
        },
        layerExportToml,
      );
      const version = typeof resp.version === "string" ? resp.version : undefined;
      results.push({ target, ok: true, version });
      if (!firstSuccess) {
        firstSuccess = {
          org_slug: target.org,
          catalog_slug: target.catalog,
          version,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ target, ok: false, error: message });
    }
  }

  if (firstSuccess && targets.length === 1) {
    updateLayerPublishedIdentity(layer.id, firstSuccess);
  }

  return results;
}

export function renderPublishResults(
  layerName: string,
  results: PublishTargetResult[],
): void {
  for (const result of results) {
    const label = formatPublishedSelector({
      org: result.target.org,
      catalog: result.target.catalog,
      name: layerName,
    });
    if (result.ok) {
      const versionSuffix = result.version ? `@${result.version}` : "";
      ui.success(`Published ${layerName} to ${label}${versionSuffix}`);
      continue;
    }

    const errorMsg = result.error ?? "Publish failed";
    if (errorMsg.includes("409")) {
      ui.danger(
        `Failed ${label}: layer slug "${layerName}" already exists in that catalog.`,
      );
      continue;
    }
    ui.danger(`Failed ${label}: ${errorMsg}`);
  }
}

export async function planLayerPublish(
  layer: Layer,
  targets: RegisteredCatalog[],
  opts?: { account?: string },
): Promise<
  Array<{
    target: RegisteredCatalog;
    account?: string;
    nextVersion?: string;
    ok: boolean;
    error?: string;
  }>
> {
  const plans = [];
  for (const target of targets) {
    const label = formatPublishCatalogSelector(target);
    const accountName = opts?.account ?? target.account;
    const accountInfo = await getCloudAccount(accountName);
    if (!accountInfo.account?.cloudBaseUrl) {
      plans.push({
        target,
        account: accountName,
        ok: false,
        error: `No cloud account configured for ${label}`,
      });
      continue;
    }

    try {
      const client = await createCloudClientForTarget(target, opts?.account);
      if (!client) {
        plans.push({
          target,
          account: accountName,
          ok: false,
          error: `No cloud account configured for ${label}`,
        });
        continue;
      }
      const { nextVersion } = await client.planLayerPublishVersion({
        layer_name: layer.name,
        org_slug: target.org,
        catalog_slug: target.catalog,
      });
      plans.push({
        target,
        account: accountInfo.accountName ?? accountName,
        nextVersion,
        ok: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plans.push({
        target,
        account: accountInfo.accountName ?? accountName,
        ok: false,
        error: message,
      });
    }
  }
  return plans;
}
