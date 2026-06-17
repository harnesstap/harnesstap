import { listEnvironments } from "../../../models/environment.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeLocalEnvironments(
  ctx: CompletionContext,
): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const candidates = listEnvironments().map((environment) => ({
      value: environment.name,
      description: environment.description || undefined,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
