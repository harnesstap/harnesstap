import { resolve } from "node:path";
import {
  hostPluginViewWrittenHash,
  isHostPluginCacheFilePath,
  isInHostPluginViewCreatedByHarnessTap,
  recordedHostPluginViewPaths,
} from "./package-cache/host-plugin-views.js";
import { hasHarnessTapMaterialization, hashFileOrLink } from "./safe-file-removal.js";

/**
 * The host plugin cache files that exist only because a HarnessTap install
 * wrote them for the apply about to run (paths under `rootPath`). A file
 * counts when its folder was created by HarnessTap, the folder's record says
 * HarnessTap wrote these exact bytes, and no earlier apply owns the path.
 * Anything else (a Claude Code install, a file the user changed, a file an
 * earlier apply wrote) was there before and is not listed.
 */
export function hostPluginFilesCreatedForApply(
  rootPath: string,
  emittedPaths: readonly string[],
): string[] {
  const candidates = new Set([
    ...emittedPaths.filter(isHostPluginCacheFilePath),
    ...recordedHostPluginViewPaths(rootPath, emittedPaths),
  ]);
  return [...candidates].filter((path) => {
    const fullPath = resolve(rootPath, path);
    if (!isInHostPluginViewCreatedByHarnessTap(fullPath)) return false;
    const written = hostPluginViewWrittenHash(fullPath);
    if (typeof written !== "string" || written !== hashFileOrLink(fullPath)) return false;
    return !hasHarnessTapMaterialization(rootPath, path);
  });
}
