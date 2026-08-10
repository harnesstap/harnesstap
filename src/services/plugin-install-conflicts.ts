import {
  getPlugin,
  isSamePublishedPluginIdentity,
} from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import type { ResolvedRemotePluginSelector } from "./plugin-selector.js";

export function resolveInstallLocalName(
  parsed: ResolvedRemotePluginSelector,
  as?: string,
): string {
  return as ?? parsed.plugin_slug;
}

export function findInstallNameConflict(
  parsed: ResolvedRemotePluginSelector,
  opts: { as?: string },
): Plugin | undefined {
  const localName = resolveInstallLocalName(parsed, opts.as);
  const existing = getPlugin(localName);
  if (!existing || opts.as) {
    return undefined;
  }
  if (isSamePublishedPluginIdentity(existing, parsed)) {
    return undefined;
  }
  return existing;
}

export function formatInstallNameConflictMessage(
  localName: string,
  existing: Plugin,
): string {
  const publishedLabel = existing.org_slug && existing.catalog_slug
    ? `${existing.org_slug}/${existing.catalog_slug}/${existing.name}`
    : existing.name;
  return `Plugin name already exists: ${localName} (published as ${publishedLabel}). Use --as to install under a different name.`;
}

export function assertInstallPluginNameAvailable(
  parsed: ResolvedRemotePluginSelector,
  opts: { as?: string },
): void {
  const conflict = findInstallNameConflict(parsed, opts);
  if (!conflict) {
    return;
  }
  throw new Error(
    formatInstallNameConflictMessage(resolveInstallLocalName(parsed, opts.as), conflict),
  );
}
