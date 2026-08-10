import {
  getLayer,
  isSamePublishedLayerIdentity,
} from "../models/plugin-model.js";
import type { Layer } from "../types.js";
import type { ResolvedRemoteLayerSelector } from "./layer-selector.js";

export function resolveInstallLocalName(
  parsed: ResolvedRemoteLayerSelector,
  as?: string,
): string {
  return as ?? parsed.layer_slug;
}

export function findInstallNameConflict(
  parsed: ResolvedRemoteLayerSelector,
  opts: { as?: string },
): Layer | undefined {
  const localName = resolveInstallLocalName(parsed, opts.as);
  const existing = getLayer(localName);
  if (!existing || opts.as) {
    return undefined;
  }
  if (isSamePublishedLayerIdentity(existing, parsed)) {
    return undefined;
  }
  return existing;
}

export function formatInstallNameConflictMessage(
  localName: string,
  existing: Layer,
): string {
  const publishedLabel = existing.org_slug && existing.catalog_slug
    ? `${existing.org_slug}/${existing.catalog_slug}/${existing.name}`
    : existing.name;
  return `Layer name already exists: ${localName} (published as ${publishedLabel}). Use --as to install under a different name.`;
}

export function assertInstallLayerNameAvailable(
  parsed: ResolvedRemoteLayerSelector,
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
