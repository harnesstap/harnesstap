import { listProfilePlugins } from "../../../constants/profile.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeProfilePlugins(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const names = [...new Set(listProfilePlugins().map((plugin) => plugin.name))];
    const candidates = names.map((name) => ({ value: name }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
