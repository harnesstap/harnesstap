import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

declare const __HT_VERSION__: string;

const GIT_SHA = /^[0-9a-f]{7,40}$/i;

export interface DevBuildVersionOptions {
  isRelease?: boolean;
  gitSha?: string | null;
}

function readPackageJsonVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}

function compactGitSha(sha: string | null | undefined): string | undefined {
  const trimmed = sha?.trim().toLowerCase();
  if (!trimmed || !GIT_SHA.test(trimmed)) {
    return undefined;
  }
  return trimmed.slice(0, 7);
}

/** True when a release workflow baked a publishable version (no `-dev+sha`). */
export function isReleaseBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HT_RELEASE === "1" || env.HARNESSTAP_RELEASE === "1";
}

/** Best-effort git SHA for the `-dev+sha` suffix. */
export function readGitSha(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | undefined {
  const fromEnv = compactGitSha(env.HT_GIT_SHA ?? env.GITHUB_SHA);
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return compactGitSha(sha);
  } catch {
    return undefined;
  }
}

/**
 * Append `-dev+<sha>` on non-release builds so CLI and Desktop can tell a
 * local/CI binary from a published version. Release builds return `version`
 * unchanged. Desktop should call this helper when reporting a newer-schema DB.
 */
export function formatDevBuildVersion(
  version: string,
  options: DevBuildVersionOptions = {},
): string {
  const trimmed = version.trim();
  if (options.isRelease) {
    return trimmed;
  }
  if (trimmed.includes("-dev+")) {
    return trimmed;
  }
  const sha = compactGitSha(options.gitSha);
  if (!sha) {
    return `${trimmed}-dev`;
  }
  return `${trimmed}-dev+${sha}`;
}

function resolvePackageVersion(): string {
  try {
    if (typeof __HT_VERSION__ === "string" && __HT_VERSION__.length > 0) {
      return __HT_VERSION__;
    }
  } catch {
    // Running from source: tsup has not injected __HT_VERSION__.
  }
  return formatDevBuildVersion(readPackageJsonVersion(), {
    isRelease: isReleaseBuild(),
    gitSha: readGitSha(),
  });
}

export const PACKAGE_VERSION: string = resolvePackageVersion();
