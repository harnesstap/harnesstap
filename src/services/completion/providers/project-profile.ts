import { findProjectConfig } from "../../project-config.js";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export function completeProjectProfileKeys(
  ctx: CompletionContext,
): CompletionCandidate[] {
  try {
    const config = findProjectConfig(process.cwd());
    if (!config) {
      return [];
    }

    const candidates = config.profiles.map((profile) => ({
      value: profile.name,
      description: profile.source,
    }));
    return filterByPrefix(candidates, ctx.prefix);
  } catch {
    return [];
  }
}
