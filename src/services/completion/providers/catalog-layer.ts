import { getCloudProfile } from "../../../config/cloud-profiles.js";
import { listLayersInScope } from "../../catalog-client.js";
import {
  formatPublishedSelector,
  formatPublishedSelectorWithVersion,
} from "../../layer-selector.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";
import { runWithCatalogTimeout } from "./catalog-timeout.js";

export async function completeCatalogLayers(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const profileInfo = await getCloudProfile(ctx.profile);
  if (!profileInfo.profile?.accessToken) {
    return [];
  }

  return runWithCatalogTimeout(async () => {
    const layers = await listLayersInScope(
      {
        q: ctx.prefix.trim() || undefined,
        limit: 25,
        sort: "updated",
      },
      { profile: profileInfo.profileName ?? undefined },
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
