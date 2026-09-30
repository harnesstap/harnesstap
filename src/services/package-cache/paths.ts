import { createHash } from "node:crypto";
import { join } from "node:path";

export const PACKAGES_CACHE_ROOT = "cache/packages";

export function packagesCacheRoot(harnesstapDir: string): string {
  return join(harnesstapDir, PACKAGES_CACHE_ROOT);
}

export function hostPluginPackagesParent(
  harnesstapDir: string,
  marketplace: string,
  pluginName: string,
): string {
  const safeMp = marketplace.replace(/[/\\]/g, "_");
  const safeName = pluginName.replace(/[/\\]/g, "_");
  return join(packagesCacheRoot(harnesstapDir), "host-plugin", safeMp, safeName);
}

export function hostPluginPackageDir(
  harnesstapDir: string,
  marketplace: string,
  pluginName: string,
  version: string,
): string {
  const safeMp = marketplace.replace(/[/\\]/g, "_");
  const safeName = pluginName.replace(/[/\\]/g, "_");
  const safeVersion = version.replace(/[/\\]/g, "_");
  return join(
    packagesCacheRoot(harnesstapDir),
    "host-plugin",
    safeMp,
    safeName,
    safeVersion,
  );
}

/** Relative path under harnesstap home for storage in SQLite. */
export function hostPluginPackageRelativePath(
  marketplace: string,
  pluginName: string,
  version: string,
): string {
  const safeMp = marketplace.replace(/[/\\]/g, "_");
  const safeName = pluginName.replace(/[/\\]/g, "_");
  const safeVersion = version.replace(/[/\\]/g, "_");
  return join(
    PACKAGES_CACHE_ROOT,
    "host-plugin",
    safeMp,
    safeName,
    safeVersion,
  );
}

export function apmGitPackageDir(
  harnesstapDir: string,
  repoUrl: string,
  commit: string,
): string {
  const digest = createHash("sha256").update(repoUrl, "utf8").digest("hex");
  return join(
    packagesCacheRoot(harnesstapDir),
    "apm-git",
    digest,
    commit.toLowerCase(),
  );
}

export function apmGitPackageRelativePath(repoUrl: string, commit: string): string {
  const digest = createHash("sha256").update(repoUrl, "utf8").digest("hex");
  return join(PACKAGES_CACHE_ROOT, "apm-git", digest, commit.toLowerCase());
}
