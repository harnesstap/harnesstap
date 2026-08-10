import { listLayers } from "../../../models/plugin-model.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeLocalLayers(ctx: CompletionContext): CompletionCandidate[] {
  if (!ctx.localDataAvailable) {
    return [];
  }

  try {
    const candidates: CompletionCandidate[] = [];
    for (const layer of listLayers()) {
      const selector = `${layer.name}@${layer.version}`;
      candidates.push({
        value: layer.name,
        description: layer.version,
      });
      candidates.push({
        value: selector,
        description: layer.description || undefined,
      });
    }
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
