import { resolveHomeRoot } from "./home-root.js";

/**
 * Show a path under the home directory as `~/...`.
 * Paths outside home are unchanged.
 */
export function shortenHomePath(path: string, home = resolveHomeRoot()): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "~" || trimmed.startsWith("~/")) {
    return trimmed;
  }
  const normalized = trimmed.replaceAll("\\", "/");
  const homeNorm = home.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (homeNorm.length < 2) {
    return trimmed;
  }
  if (normalized === homeNorm) {
    return "~";
  }
  if (normalized.startsWith(`${homeNorm}/`)) {
    return `~${normalized.slice(homeNorm.length)}`;
  }
  return trimmed;
}
