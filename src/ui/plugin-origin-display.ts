import type { PluginOrigin } from "../types.js";
import { parseDependencyRef } from "../utils/plugin-dependency-ref.js";
import { parseOriginLocator } from "../utils/plugin-origin-locator.js";

/**
 * Human origin label for plugin packages.
 * Marketplace imports show the marketplace name, not the storage enum.
 */
export function formatPluginOriginDisplay(
  origin: PluginOrigin,
  originLocator?: string | null,
): string {
  if (origin === "authored") {
    return "authored";
  }
  const locator = originLocator?.trim()
    ? parseOriginLocator(originLocator)
    : null;
  if (!locator) {
    return origin;
  }
  switch (locator.kind) {
    case "marketplace": {
      const parsed = parseDependencyRef(locator.ref);
      return parsed.namespace || locator.ref;
    }
    case "git":
      return locator.url;
    case "catalog":
      return `${locator.org}/${locator.catalog}`;
    default: {
      const _exhaustive: never = locator;
      return _exhaustive;
    }
  }
}
