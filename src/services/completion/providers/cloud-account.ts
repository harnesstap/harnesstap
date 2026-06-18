import { loadCloudAccounts } from "../../../config/cloud-accounts.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export async function completeCloudAccounts(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  if (!ctx.localDataAvailable) {
    return [];
  }
  try {
    const store = await loadCloudAccounts();
    const candidates = Object.keys(store.accounts ?? {}).map((name) => ({
      value: name,
      description: store.default_account === name ? "default" : undefined,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
