import { listPlugins } from "../../../models/plugin-model.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeLocalPlugins(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const candidates: CompletionCandidate[] = [];
    for (const plugin of listPlugins()) {
      const selector = `${plugin.name}@${plugin.version}`;
      candidates.push({
        value: plugin.name,
        description: plugin.version,
      });
      candidates.push({
        value: selector,
        description: plugin.description || undefined,
      });
    }
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
