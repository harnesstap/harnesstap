import { loadCloudProfiles } from "../../../config/cloud-profiles.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export async function completeCloudProfiles(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const store = await loadCloudProfiles();
    const candidates = Object.keys(store.profiles ?? {}).map((name) => ({
      value: name,
      description: store.default_profile === name ? "default" : undefined,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
