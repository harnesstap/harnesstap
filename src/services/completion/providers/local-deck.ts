import { listDecks } from "../../../models/deck.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeLocalDecks(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const candidates = listDecks().map((deck) => ({
      value: deck.name,
      description: deck.root_path || undefined,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
