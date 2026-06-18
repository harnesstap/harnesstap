import { getCloudAccount } from "../../../config/cloud-accounts.js";
import { createCloudClient } from "../../cloud-client.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export async function completeCatalogOrgs(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const accountInfo = await getCloudAccount(ctx.account);
  const account = accountInfo.account;
  if (!account?.accessToken) {
    return [];
  }

  try {
    const client = createCloudClient({
      baseUrl: account.cloudBaseUrl,
      token: {
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
        expires_at:
          typeof account.accessTokenExpiresAt === "number"
            ? account.accessTokenExpiresAt
            : account.accessTokenExpiresAt
              ? Math.floor(Date.parse(String(account.accessTokenExpiresAt)) / 1000)
              : undefined,
      },
    });
    const orgs = await client.listOrgs();
    const candidates = orgs.map((org) => ({
      value: String(org.slug),
      description: String(org.name ?? org.slug),
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
