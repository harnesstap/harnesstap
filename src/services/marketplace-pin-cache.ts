import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { downloadHostPluginVersion } from "./host-plugin-source.js";
import {
  ensureMarketplaceCatalog,
  marketplaceCacheDir,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";
import { ingestHostPluginTreeIntoCache } from "./package-cache/host-plugin.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";
import { resolveMarketplacePluginDirectory } from "./plugin-origin-apply.js";

export function resolveCatalogPluginVersion(
  advertised: string | undefined,
  versionConstraint: string | undefined,
): string {
  const constraint = versionConstraint?.trim();
  if (constraint && constraint !== "latest" && constraint !== "*") {
    return constraint;
  }
  if (advertised?.trim()) {
    return advertised.trim();
  }
  return "0.0.0";
}

export function installMarketplacePinIntoCache(input: {
  originRef: string;
  versionConstraint?: string;
  homeRoot?: string;
  harnesstapDir?: string;
}): { version: string; install_path: string } {
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    throw new Error(`Plugin ${input.originRef} is not a marketplace pin`);
  }
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  refreshMarketplaceCatalog(harnesstapDir, { name: marketplace, force: false });
  const catalog = ensureMarketplaceCatalog(harnesstapDir, { name: marketplace });
  const entry = catalog.find((plugin) => plugin.name === name);
  const version = resolveCatalogPluginVersion(entry?.version, input.versionConstraint);
  const checkout = marketplaceCacheDir(harnesstapDir, marketplace);
  const fromCatalog =
    (entry?.sourcePath ? join(checkout, entry.sourcePath) : undefined)
    ?? resolveMarketplacePluginDirectory(checkout, name);
  if (fromCatalog && existsSync(fromCatalog) && isPluginInstallRoot(fromCatalog)) {
    const cached = ingestHostPluginTreeIntoCache({
      harnesstapDir,
      homeRoot,
      originRef: input.originRef,
      sourceInstallRoot: fromCatalog,
      version,
    });
    return { version, install_path: cached };
  }
  const downloaded = downloadHostPluginVersion({
    originRef: input.originRef,
    version,
    homeRoot,
    harnesstapDir,
  });
  const cached = ingestHostPluginTreeIntoCache({
    harnesstapDir,
    homeRoot,
    originRef: input.originRef,
    sourceInstallRoot: downloaded.install_path,
    version: downloaded.version,
  });
  return { version: downloaded.version, install_path: cached };
}
