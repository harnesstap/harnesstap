import { listScenarioIds } from "../../scenario-guide.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider } from "../types.js";
import { filterByPrefix } from "../utils.js";

export const completeScenarioIds: CompletionProvider = (
  ctx: CompletionContext,
): CompletionCandidate[] =>
  filterByPrefix(
    listScenarioIds().map((id) => ({ value: String(id) })),
    ctx.prefix,
  );
