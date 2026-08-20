import semver from "semver";
import { getPluginResources, listPlugins } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { parseDependencyRef } from "./plugin-dependency.js";

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

export function recoverOriginLocator(plugin: Plugin): OriginLocator | null {
  if (plugin.origin === "authored") {
    return null;
  }

  if (plugin.origin_locator) {
    return parseOriginLocator(plugin.origin_locator);
  }

  if (plugin.org_slug && plugin.catalog_slug) {
    return {
      kind: "catalog",
      org: plugin.org_slug,
      catalog: plugin.catalog_slug,
      slug: plugin.ap_name || plugin.name,
    };
  }

  for (const resource of getPluginResources(plugin.id)) {
    if (resource.origin_kind !== "marketplace_link" || !resource.origin_ref) {
      continue;
    }
    const parsed = parseDependencyRef(resource.origin_ref);
    if (parsed.source_kind === "marketplace") {
      return { kind: "marketplace", ref: resource.origin_ref };
    }
    if (parsed.source_kind === "git") {
      return { kind: "git", url: resource.origin_ref };
    }
  }

  return null;
}

export function listOriginUpdateCandidates(): Plugin[] {
  return listPlugins().filter(
    (plugin) =>
      !plugin.frozen_at && (plugin.origin === "upstream" || plugin.origin === "catalog"),
  );
}

export function selectOriginUpdateTarget(
  candidates: Plugin[],
): Array<{ target: Plugin; skipped: Plugin[] }> {
  const groups = new Map<string, Plugin[]>();
  for (const plugin of candidates) {
    const locator = recoverOriginLocator(plugin);
    if (!locator) continue;
    const key = formatOriginLocator(locator);
    const existing = groups.get(key) ?? [];
    existing.push(plugin);
    groups.set(key, existing);
  }

  const result: Array<{ target: Plugin; skipped: Plugin[] }> = [];
  for (const plugins of groups.values()) {
    const sorted = [...plugins].sort((left, right) => {
      try {
        return semver.rcompare(left.version, right.version);
      } catch {
        return 0;
      }
    });
    const target = sorted[0];
    if (!target) continue;
    result.push({ target, skipped: sorted.slice(1) });
  }
  return result;
}
