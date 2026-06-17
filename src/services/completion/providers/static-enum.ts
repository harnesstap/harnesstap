import type { CompletionCandidate, CompletionContext, CompletionProvider } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function staticEnumProvider(values: readonly string[]): CompletionProvider {
  return (ctx: CompletionContext): CompletionCandidate[] =>
    filterByPrefix(
      values.map((value) => ({ value })),
      ctx.prefix,
    );
}
