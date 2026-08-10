import { getCloudAccount } from "../config/cloud-accounts.js";
import type { RegisteredCatalog } from "../config/catalog.js";
import { formatPublishCatalogSelector } from "../config/catalog.js";
import { exportPlugin } from "./plugin-export.js";
import { formatPluginExportToml } from "./transport/plugin.js";
import { updatePluginPublishedIdentity } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import type { CloudClient } from "./cloud-client.js";
import { createPersistingCloudClient } from "./cloud-account-auth.js";
import { formatPublishedSelector } from "./plugin-selector.js";
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

export async function publishPluginToCatalogs(
  plugin: Plugin,
  targets: RegisteredCatalog[],
  opts?: { account?: string },
): Promise<PublishTargetResult[]> {
  const pluginExport = exportPlugin(plugin.id);
  const pluginExportToml = formatPluginExportToml(pluginExport);
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

      const resp = await client.publishPluginExport(
        {
          plugin_name: plugin.name,
          org_slug: target.org,
          catalog_slug: target.catalog,
        },
        pluginExportToml,
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
    updatePluginPublishedIdentity(plugin.id, firstSuccess);
  }

  return results;
}

export function renderPublishResults(
  pluginName: string,
  results: PublishTargetResult[],
): void {
  for (const result of results) {
    const label = formatPublishedSelector({
      org: result.target.org,
      catalog: result.target.catalog,
      name: pluginName,
    });
    if (result.ok) {
      const versionSuffix = result.version ? `@${result.version}` : "";
      ui.success(`Published ${pluginName} to ${label}${versionSuffix}`);
      continue;
    }

    const errorMsg = result.error ?? "Publish failed";
    if (errorMsg.includes("409")) {
      ui.danger(
        `Failed ${label}: plugin slug "${pluginName}" already exists in that catalog.`,
      );
      continue;
    }
    ui.danger(`Failed ${label}: ${errorMsg}`);
  }
}

export async function planPluginPublish(
  plugin: Plugin,
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
      const { nextVersion } = await client.planPluginPublishVersion({
        plugin_name: plugin.name,
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
