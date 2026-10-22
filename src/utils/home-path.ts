import { resolveHomeRoot } from "./home-root.js";

/** Drive-letter or UNC paths compare case-insensitively, like Windows does. */
function isWindowsStylePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * Show a path under the home directory as `~/...`.
 * Paths outside home are unchanged. A path that only shares a prefix with
 * home (`/home/me-other` for `/home/me`) is outside home.
 */
export function shortenHomePath(path: string, home = resolveHomeRoot()): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return trimmed.replaceAll("\\", "/");
  }
  const normalized = trimmed.replaceAll("\\", "/");
  const homeNorm = home.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (homeNorm.length < 2) {
    return trimmed;
  }
  const windows = isWindowsStylePath(home.trim()) || isWindowsStylePath(trimmed);
  const comparablePath = windows ? normalized.toLowerCase() : normalized;
  const comparableHome = windows ? homeNorm.toLowerCase() : homeNorm;
  if (comparablePath === comparableHome) {
    return "~";
  }
  if (comparablePath.startsWith(`${comparableHome}/`)) {
    return `~${normalized.slice(homeNorm.length)}`;
  }
  return trimmed;
}
