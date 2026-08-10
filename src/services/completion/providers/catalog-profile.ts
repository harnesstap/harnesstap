import { PROFILE_PLUGIN_TAG } from "../../../constants/profile.js";
import { getCloudAccount } from "../../../config/cloud-accounts.js";
import { listPluginsInScope } from "../../catalog-client.js";
import {
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
} from "../../plugin-selector.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";
import { runWithCatalogTimeout } from "./catalog-timeout.js";

export async function completeCatalogProfiles(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const accountInfo = await getCloudAccount(ctx.account);
  if (!accountInfo.account?.accessToken) {
    return [];
  }

  return runWithCatalogTimeout(async () => {
    const plugins = await listPluginsInScope(
      {
        q: ctx.prefix.trim() || undefined,
        tag: PROFILE_PLUGIN_TAG,
        limit: 25,
        sort: "updated",
      },
      { account: accountInfo.accountName ?? undefined },
    );

    const candidates = plugins.flatMap((plugin) => {
      const selector = formatPublishedSelector({
        org: plugin.orgSlug,
        catalog: plugin.catalogSlug,
        name: plugin.slug,
      });
      const withVersion = plugin.latestVersion
        ? formatPublishedSelectorWithVersion({
            org: plugin.orgSlug,
            catalog: plugin.catalogSlug,
            name: plugin.slug,
            version: plugin.latestVersion,
          })
        : selector;

      const entries: CompletionCandidate[] = [
        {
          value: selector,
          description: plugin.name,
        },
      ];
      if (withVersion !== selector) {
        entries.push({
          value: withVersion,
          description: plugin.latestVersion ?? undefined,
        });
      }
      return entries;
    });

    return filterByPrefix(candidates, ctx.prefix);
  });
}
