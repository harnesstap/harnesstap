import { getAllPlatforms } from "../../../platforms/registry.js";
import { getDedicatedSerializerPlatformIds } from "../../platform-serializers.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeHarnessSlugs(ctx: CompletionContext): CompletionCandidate[] {
  const slugs = new Set<string>([
    ...getDedicatedSerializerPlatformIds(),
    ...getAllPlatforms().map((platform) => platform.id),
  ]);
  const candidates = [...slugs].map((slug) => {
    const platform = getAllPlatforms().find((entry) => entry.id === slug);
    return {
      value: slug,
      description: platform?.name,
    };
  });
  return filterByPrefix(candidates, ctx.prefix);
}
