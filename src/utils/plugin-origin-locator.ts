import { parseDependencyRef } from "./plugin-dependency-ref.js";

export type OriginLocator =
  | { kind: "marketplace"; ref: string }
  /** `ref` pins a commit, tag or branch (#500). Stored as `<url>#<ref>`. */
  | { kind: "git"; url: string; ref?: string }
  | { kind: "catalog"; org: string; catalog: string; slug: string };

export function formatOriginLocator(locator: OriginLocator): string {
  switch (locator.kind) {
    case "marketplace":
      return locator.ref;
    case "git":
      return locator.ref ? `${locator.url}#${locator.ref}` : locator.url;
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
    return splitGitLocator(trimmed);
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

/**
 * `<url>#<ref>` pins a git origin to a commit, tag or branch. A locator
 * written before pins existed has no `#` and tracks the default branch.
 */
export function splitGitLocator(raw: string): { kind: "git"; url: string; ref?: string } {
  const hash = raw.lastIndexOf("#");
  if (hash <= 0) return { kind: "git", url: raw };
  const url = raw.slice(0, hash);
  const ref = raw.slice(hash + 1).trim();
  return ref ? { kind: "git", url, ref } : { kind: "git", url };
}
