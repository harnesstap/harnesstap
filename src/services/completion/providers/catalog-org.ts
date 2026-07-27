import { createPersistingCloudClient } from "../../cloud-account-auth.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export async function completeCatalogOrgs(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const created = await createPersistingCloudClient(ctx.account);
  if (!created) {
    return [];
  }

  try {
    const orgs = await created.client.listOrgs();
    const candidates = orgs.map((org) => ({
      value: String(org.slug),
      description: String(org.name ?? org.slug),
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
