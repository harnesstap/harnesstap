import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import semver from "semver";
import { getHarnesstapDir } from "../db/connection.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { declaredPluginVersion, downloadHostPluginVersion } from "./host-plugin-source.js";
import {
  ensureMarketplaceCatalog,
  marketplaceCacheDir,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";
import { ingestHostPluginTreeIntoCache } from "./package-cache/host-plugin.js";
import { hostPluginPackageDir } from "./package-cache/paths.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";
import { resolveMarketplacePluginDirectory } from "./plugin-origin-apply.js";
import { checkoutPluginVersionFromHistory } from "./marketplace-plugin-history.js";
import { parseVersionConstraint } from "./plugin-constraints.js";

function exactConstraintVersion(constraint: string | undefined): string | undefined {
  const trimmed = constraint?.trim();
  if (!trimmed || trimmed === "latest" || trimmed === "*") return undefined;
  try {
    const parsed = parseVersionConstraint(trimmed);
    return parsed.kind === "exact" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/** What the plugin tree in the marketplace checkout says it is. */
function checkoutPluginVersion(pluginDir: string, advertised: string | undefined): string | undefined {
  const declared = declaredPluginVersion(pluginDir);
  if (declared) return declared;
  // resolveVersion falls back to a commit for entries with no version.
  return advertised && semver.valid(advertised) ? advertised : undefined;
}

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

export async function installMarketplacePinIntoCache(input: {
  originRef: string;
  versionConstraint?: string;
  homeRoot?: string;
  harnesstapDir?: string;
}): Promise<{ version: string; install_path: string }> {
  const { name, marketplace } = parsePluginRef(input.originRef);
  if (!marketplace) {
    throw new Error(`Plugin ${input.originRef} is not a marketplace pin`);
  }
  const homeRoot = input.homeRoot ?? resolveHomeRoot();
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  await refreshMarketplaceCatalog(harnesstapDir, {
    name: marketplace,
    force: false,
    unattended: false,
  });
  const catalog = await ensureMarketplaceCatalog(harnesstapDir, { name: marketplace });
  const entry = catalog.find((plugin) => plugin.name === name);
  const version = resolveCatalogPluginVersion(entry?.version, input.versionConstraint);
  const checkout = marketplaceCacheDir(harnesstapDir, marketplace);
  const fromCatalog =
    (entry?.sourcePath ? join(checkout, entry.sourcePath) : undefined)
    ?? resolveMarketplacePluginDirectory(checkout, name);
  const pinned = exactConstraintVersion(input.versionConstraint);
  if (fromCatalog && existsSync(fromCatalog) && isPluginInstallRoot(fromCatalog)) {
    const current = checkoutPluginVersion(fromCatalog, entry?.version);
    if (pinned && current && current !== pinned) {
      // The marketplace copy declares another version: never cache it under
      // the pinned one. Try a release tag, then the marketplace history.
      return await installDeclaredVersion({
        originRef: input.originRef,
        marketplace,
        name,
        pinned,
        current,
        checkout,
        pluginDir: fromCatalog,
        homeRoot,
        harnesstapDir,
      });
    }
    const cached = ingestHostPluginTreeIntoCache({
      harnesstapDir,
      homeRoot,
      originRef: input.originRef,
      sourceInstallRoot: fromCatalog,
      version,
    });
    return { version, install_path: cached };
  }
  return downloadAndIngest(input.originRef, version, homeRoot, harnesstapDir);
}

async function installDeclaredVersion(input: {
  originRef: string;
  marketplace: string;
  name: string;
  pinned: string;
  current: string;
  checkout: string;
  pluginDir: string;
  homeRoot: string;
  harnesstapDir: string;
}): Promise<{ version: string; install_path: string }> {
  const { originRef, pinned, homeRoot, harnesstapDir } = input;
  const cachedDir = hostPluginPackageDir(harnesstapDir, input.marketplace, input.name, pinned);
  if (existsSync(cachedDir) && isPluginInstallRoot(cachedDir)) {
    const cached = ingestHostPluginTreeIntoCache({
      harnesstapDir,
      homeRoot,
      originRef,
      sourceInstallRoot: cachedDir,
      version: pinned,
    });
    return { version: pinned, install_path: cached };
  }
  let tagMessage = "";
  try {
    return await downloadAndIngest(originRef, pinned, homeRoot, harnesstapDir);
  } catch (error) {
    tagMessage = error instanceof Error ? error.message : String(error);
  }
  const scratch = mkdtempSync(join(tmpdir(), "ht-pin-history-"));
  try {
    const historic = await checkoutPluginVersionFromHistory({
      checkoutDir: input.checkout,
      sourcePath: relative(input.checkout, input.pluginDir),
      version: pinned,
      targetDir: scratch,
    });
    if (historic.ok) {
      const cached = ingestHostPluginTreeIntoCache({
        harnesstapDir,
        homeRoot,
        originRef,
        sourceInstallRoot: scratch,
        version: pinned,
      });
      return { version: pinned, install_path: cached };
    }
    throw new Error(
      `${originRef} is ${input.current} in the marketplace and ${pinned} was not found (${tagMessage}; in the marketplace history, ${historic.message}). Pin ${input.current}, or a version it has released.`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function downloadAndIngest(
  originRef: string,
  version: string,
  homeRoot: string,
  harnesstapDir: string,
): Promise<{ version: string; install_path: string }> {
  const downloaded = await downloadHostPluginVersion({
    originRef,
    version,
    homeRoot,
    harnesstapDir,
  });
  const cached = ingestHostPluginTreeIntoCache({
    harnesstapDir,
    homeRoot,
    originRef,
    sourceInstallRoot: downloaded.install_path,
    version: downloaded.version,
  });
  return { version: downloaded.version, install_path: cached };
}
