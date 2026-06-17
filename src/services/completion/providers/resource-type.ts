import { LISTABLE_RESOURCE_TYPES } from "../../../types.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeResourceTypes(ctx: CompletionContext): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = LISTABLE_RESOURCE_TYPES.map((type) => ({
    value: type,
  }));
  return filterByPrefix(candidates, ctx.prefix);
}
