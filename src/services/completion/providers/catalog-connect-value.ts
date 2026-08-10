import type { CompletionCandidate, CompletionContext } from "../types.js";
import { completeCatalogPlugins } from "./catalog-plugin.js";
import { completeCatalogOrgs } from "./catalog-org.js";

export async function completeCatalogConnectValue(
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const target = ctx.consumedPositionals?.[0]?.toLowerCase();
  if (target === "org") {
    return completeCatalogOrgs(ctx);
  }
  if (target === "plugin") {
    return completeCatalogPlugins(ctx);
  }
  return [];
}
