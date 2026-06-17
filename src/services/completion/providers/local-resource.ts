import {
  formatResourceSelector,
  listResources,
} from "../../../models/resource.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeLocalResources(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const candidates = listResources().map((resource) => ({
      value: formatResourceSelector(resource),
      description: resource.type,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
