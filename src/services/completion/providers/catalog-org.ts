import { getCloudProfile } from "../../../config/cloud-profiles.js";
import { createCloudClient } from "../../cloud-client.js";
import { resolveCloudBaseUrl } from "../../../config/catalog.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";
import { runWithCatalogTimeout } from "./catalog-timeout.js";

export async function completeCatalogOrgs(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const profileInfo = await getCloudProfile(ctx.profile);
  const profile = profileInfo.profile;
  if (!profile?.accessToken) {
    return [];
  }

  return runWithCatalogTimeout(async () => {
    const client = createCloudClient({
      baseUrl: profile.cloudBaseUrl || resolveCloudBaseUrl(),
      token: {
        access_token: profile.accessToken!,
        refresh_token: profile.refreshToken,
        expires_at:
          typeof profile.accessTokenExpiresAt === "number"
            ? profile.accessTokenExpiresAt
            : profile.accessTokenExpiresAt
              ? Math.floor(Date.parse(String(profile.accessTokenExpiresAt)) / 1000)
              : undefined,
      },
    });

    const orgs = await client.listOrgs();
    const candidates: CompletionCandidate[] = [];
    for (const entry of orgs) {
      const slug = typeof entry.slug === "string" ? entry.slug : "";
      if (!slug) {
        continue;
      }
      const name = typeof entry.name === "string" ? entry.name : undefined;
      candidates.push({
        value: slug,
        description: name,
      });
    }

    return filterByPrefix(candidates, ctx.prefix);
  });
}
