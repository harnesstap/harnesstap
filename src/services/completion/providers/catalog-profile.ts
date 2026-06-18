import { PROFILE_LAYER_TAG } from "../../../constants/profile.js";
import { getCloudAccount } from "../../../config/cloud-accounts.js";
import { listLayersInScope } from "../../catalog-client.js";
import {
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
} from "../../layer-selector.js";
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
    const layers = await listLayersInScope(
      {
        q: ctx.prefix.trim() || undefined,
        tag: PROFILE_LAYER_TAG,
        limit: 25,
        sort: "updated",
      },
      { account: accountInfo.accountName ?? undefined },
    );

    const candidates = layers.flatMap((layer) => {
      const selector = formatPublishedSelector({
        org: layer.orgSlug,
        catalog: layer.catalogSlug,
        name: layer.slug,
      });
      const withVersion = layer.latestVersion
        ? formatPublishedSelectorWithVersion({
            org: layer.orgSlug,
            catalog: layer.catalogSlug,
            name: layer.slug,
            version: layer.latestVersion,
          })
        : selector;

      const entries: CompletionCandidate[] = [
        {
          value: selector,
          description: layer.name,
        },
      ];
      if (withVersion !== selector) {
        entries.push({
          value: withVersion,
          description: layer.latestVersion ?? undefined,
        });
      }
      return entries;
    });

    return filterByPrefix(candidates, ctx.prefix);
  });
}
