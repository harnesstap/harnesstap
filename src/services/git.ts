import { execSync } from "node:child_process";
import { basename } from "node:path";

/**
 * Detect the git remote origin URL for a project directory.
 * Returns undefined if not a git repo or no origin remote.
 *
 * Reads the stored `remote.origin.url` so url.*.insteadOf rewrites (credential
 * helpers) do not change project identity.
 */
export function getGitOrigin(projectRoot: string): string | undefined {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a git remote URL to a canonical form.
 * - Strips trailing .git if present
 * - Converts HTTPS URLs to a common format
 * - Preserves SSH URLs as-is
 *
 * Examples:
 *   git@github.com:org/repo.git     → git@github.com:org/repo.git
 *   https://github.com/org/repo.git → https://github.com/org/repo
 *   https://github.com/org/repo     → https://github.com/org/repo
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // SSH URLs: keep as-is (they're already canonical)
  if (normalized.startsWith("git@")) {
    return normalized;
  }

  // HTTPS: strip trailing .git
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4);
  }

  return normalized;
}

/**
 * Extract a human-readable project name from a git URL.
 * e.g. "git@github.com:org/repo.git" → "org/repo"
 */
export function projectNameFromUrl(url: string): string {
  // SSH format: git@github.com:org/repo.git
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];

  // HTTPS format: https://github.com/org/repo
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
    return path || basename(url);
  } catch {
    return basename(url).replace(/\.git$/, "");
  }
}
