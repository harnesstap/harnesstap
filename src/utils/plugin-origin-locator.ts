import { parseDependencyRef } from "./plugin-dependency-ref.js";

export type OriginLocator =
  | { kind: "marketplace"; ref: string }
  | { kind: "git"; url: string }
  | { kind: "catalog"; org: string; catalog: string; slug: string };

export function formatOriginLocator(locator: OriginLocator): string {
  switch (locator.kind) {
    case "marketplace":
      return locator.ref;
    case "git":
      return locator.url;
    case "catalog":
      return `${locator.org}/${locator.catalog}/${locator.slug}`;
    default: {
      const _exhaustive: never = locator;
      return _exhaustive;
    }
  }
}

export function parseOriginLocator(raw: string): OriginLocator | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parseDependencyRef(trimmed);
  if (parsed.source_kind === "git") {
    return { kind: "git", url: trimmed };
  }

  const slashParts = trimmed.split("/");
  if (slashParts.length === 3 && !trimmed.includes("@")) {
    const [org, catalog, slug] = slashParts;
    if (org && catalog && slug) {
      return { kind: "catalog", org, catalog, slug };
    }
  }

  if (trimmed.includes("@")) {
    return { kind: "marketplace", ref: trimmed };
  }

  return null;
}
