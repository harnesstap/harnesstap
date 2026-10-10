import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  marketplaceAddFailedNothingSaved,
  marketplacePathMissing,
  marketplacePathNotMarketplace,
  marketplaceUnreachable,
  marketplaceUnreachableHint,
} from "../copy/cli.js";
import { MARKETPLACE_TYPE_CANDIDATES } from "./marketplace-type-detect.js";
import {
  checkMarketplaceReachability,
  type CheckMarketplaceReachabilityOptions,
} from "./marketplace-reachability.js";
import { normalizeMarketplaceUrl } from "./marketplace-registry.js";

export class MarketplaceSourceError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "MarketplaceSourceError";
    this.hint = hint;
  }
}

function isLocalFilesystemSource(value: string): boolean {
  if (value.startsWith("file:")) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  if (value.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

export function localMarketplaceHasManifest(root: string): boolean {
  return MARKETPLACE_TYPE_CANDIDATES.some((candidate) =>
    existsSync(join(root, candidate.path)),
  );
}

export async function assertMarketplaceSourceReachable(
  source: string,
  options: CheckMarketplaceReachabilityOptions = {},
): Promise<void> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new MarketplaceSourceError(
      marketplaceUnreachable(source),
      marketplaceUnreachableHint(),
    );
  }

  if (isLocalFilesystemSource(trimmed)) {
    const path = normalizeMarketplaceUrl(trimmed);
    if (!path || !existsSync(path)) {
      throw new MarketplaceSourceError(
        marketplacePathMissing(path || trimmed),
        marketplaceAddFailedNothingSaved(),
      );
    }
    if (!localMarketplaceHasManifest(path)) {
      throw new MarketplaceSourceError(
        marketplacePathNotMarketplace(path),
        marketplaceAddFailedNothingSaved(),
      );
    }
    return;
  }

  const reachability = await checkMarketplaceReachability(trimmed, options);
  if (reachability.status === "healthy") {
    return;
  }
  throw new MarketplaceSourceError(
    marketplaceUnreachable(normalizeMarketplaceUrl(trimmed) || trimmed),
    marketplaceUnreachableHint(),
  );
}
