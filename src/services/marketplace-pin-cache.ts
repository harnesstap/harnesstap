import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import semver from "semver";
import { getHarnesstapDir } from "../db/connection.js";
import { parsePluginRef, readManifestVersion } from "../plugins/claude-installed.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  declaredPluginVersion,
  downloadHostPluginUnpinned,
  downloadHostPluginVersion,
} from "./host-plugin-source.js";
import {
  ensureMarketplaceCatalog,
  listCatalogPlugins,
  marketplaceCacheDir,
  refreshMarketplaceCatalog,
} from "./marketplace-catalog.js";
import { ingestHostPluginTreeIntoCache } from "./package-cache/host-plugin.js";
import { hostPluginPackageDir } from "./package-cache/paths.js";
import { isPluginInstallRoot } from "./plugin-source-import.js";
import { resolveMarketplacePluginDirectory } from "./plugin-origin-apply.js";
import { checkoutPluginVersionFromHistory } from "./marketplace-plugin-history.js";

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

function checkoutManifestVersion(installRoot: string): string | undefined {
  const { version } = readManifestVersion(installRoot);
  return version !== "unknown" && version.trim() ? version.trim() : undefined;
}

/** The version an exact semver constraint names, or null for ranges, `*` and `latest`. */
export function exactPinnedVersion(versionConstraint: string | undefined): string | null {
  const trimmed = versionConstraint?.trim() ?? "";
  return semver.valid(trimmed) === trimmed && trimmed.length > 0 ? trimmed : null;
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

  // An exact version already in the package cache needs no network: a slow or
  // unreachable marketplace remote must not hold up every apply (O3).
  const pinned = exactPinnedVersion(input.versionConstraint);
  if (pinned) {
    const canonical = hostPluginPackageDir(harnesstapDir, marketplace, name, pinned);
    if (existsSync(canonical) && isPluginInstallRoot(canonical)) {
      const cached = ingestHostPluginTreeIntoCache({
        harnesstapDir,
        homeRoot,
        originRef: input.originRef,
        sourceInstallRoot: canonical,
        version: pinned,
      });
      return { version: pinned, install_path: cached };
    }
  }

  // Refresh in the foreground only when the stored catalog cannot answer:
  // no catalog yet, the plugin is not listed, or it lists another version
  // than the exact pin. Otherwise use the stored catalog; a stale one is
  // refreshed in the background with the short unattended timeout.
  const storedEntry = listCatalogPlugins(harnesstapDir, { name: marketplace }).find(
    (plugin) => plugin.name === name,
  );
  const storedAnswers =
    storedEntry !== undefined && (!pinned || storedEntry.version?.trim() === pinned);
  if (!storedAnswers) {
    await refreshMarketplaceCatalog(harnesstapDir, {
      name: marketplace,
      force: false,
      unattended: false,
    });
  }
  const catalog = await ensureMarketplaceCatalog(harnesstapDir, { name: marketplace });
  const entry = catalog.find((plugin) => plugin.name === name);
  const checkout = marketplaceCacheDir(harnesstapDir, marketplace);
  const fromCatalog =
    (entry?.sourcePath ? join(checkout, entry.sourcePath) : undefined)
    ?? resolveMarketplacePluginDirectory(checkout, name);
  const inCheckout = fromCatalog && existsSync(fromCatalog) && isPluginInstallRoot(fromCatalog);
  if (inCheckout && fromCatalog && pinned) {
    const current = checkoutPluginVersion(fromCatalog, entry?.version);
    if (current && current !== pinned) {
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
  }
  // marketplace.json may leave the version out; the plugin's own manifest then
  // names it, as it does for Claude (O2), instead of a made-up 0.0.0.
  const manifestVersion = inCheckout ? checkoutManifestVersion(fromCatalog) : undefined;
  const version = resolveCatalogPluginVersion(
    entry?.version?.trim() ? entry.version : manifestVersion,
    input.versionConstraint,
  );
  if (inCheckout && fromCatalog) {
    const cached = ingestHostPluginTreeIntoCache({
      harnesstapDir,
      homeRoot,
      originRef: input.originRef,
      sourceInstallRoot: fromCatalog,
      version,
    });
    return { version, install_path: cached };
  }
  const constraint = input.versionConstraint?.trim();
  const unpinned = !constraint || constraint === "*" || constraint === "latest";
  const advertised = entry?.version?.trim() ? entry.version.trim() : manifestVersion;
  if (unpinned && !(advertised && semver.valid(advertised))) {
    // The entry lists a commit or no version: take the plugin at the commit
    // it pins (or the default branch) and the version its plugin.json names.
    return installUnpinnedSource(input.originRef, homeRoot, harnesstapDir);
  }
  return downloadAndIngest(input.originRef, version, homeRoot, harnesstapDir);
}

async function installUnpinnedSource(
  originRef: string,
  homeRoot: string,
  harnesstapDir: string,
): Promise<{ version: string; install_path: string }> {
  const scratch = mkdtempSync(join(tmpdir(), "ht-pin-unpinned-"));
  try {
    const target = join(scratch, "plugin");
    const { declaredVersion } = await downloadHostPluginUnpinned({
      originRef,
      targetDir: target,
      homeRoot,
      harnesstapDir,
    });
    const version = declaredVersion ?? "0.0.0";
    const cached = ingestHostPluginTreeIntoCache({
      harnesstapDir,
      homeRoot,
      originRef,
      sourceInstallRoot: target,
      version,
    });
    return { version, install_path: cached };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
