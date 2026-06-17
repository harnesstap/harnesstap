import type { CompletionCandidate } from "../types.js";

const CATALOG_TIMEOUT_MS = 300;

export async function runWithCatalogTimeout(
  fn: () => Promise<CompletionCandidate[]>,
): Promise<CompletionCandidate[]> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<CompletionCandidate[]>((resolve) => {
        setTimeout(() => resolve([]), CATALOG_TIMEOUT_MS);
      }),
    ]);
    return result;
  } catch {
    return [];
  }
}
