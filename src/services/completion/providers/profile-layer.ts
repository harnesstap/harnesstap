import { listProfileLayers } from "../../../constants/profile.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeProfileLayers(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const names = [...new Set(listProfileLayers().map((layer) => layer.name))];
    const candidates = names.map((name) => ({ value: name }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
