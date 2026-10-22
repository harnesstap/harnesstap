import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  githubGitConfigArgs,
  githubHttpsRemoteForAuth,
  resolveGithubAccessToken,
} from "../services/github-credentials.js";
import {
  DEFAULT_GIT_CLONE_TIMEOUT_MS,
  runCommandWithTimeout,
} from "../utils/run-command-with-timeout.js";
import { UNATTENDED_GIT_TIMEOUT_MS } from "../utils/spawn-command.js";
import { isCommandTimeoutStderr, mapGitStderr } from "../utils/git-errors.js";
import { resolveCommandResult, type RunCommand } from "./run-command.js";

export interface GitRefreshOptions {
  url: string;
  ref?: string;
  targetDir: string;
  runCommand?: RunCommand;
  /** Background catalog refresh. Shorter timeout, no prompt, SSH connect limit. */
  unattended?: boolean;
}

export async function refreshGitSource(opts: GitRefreshOptions): Promise<{
  ok: boolean;
  sha?: string;
  message: string;
  /** git was stopped at its timeout; nothing in `targetDir` changed. */
  timedOut?: boolean;
}> {
  const run = opts.runCommand ?? runCommandWithTimeout;
  const unattended = opts.unattended === true;
  const timeoutMs = unattended ? UNATTENDED_GIT_TIMEOUT_MS : DEFAULT_GIT_CLONE_TIMEOUT_MS;
  const staging = `${opts.targetDir}.incoming`;
  if (existsSync(staging)) {
    rmSync(staging, { recursive: true, force: true });
  }
  mkdirSync(staging, { recursive: true });

  const token = resolveGithubAccessToken().token;
  const url = githubHttpsRemoteForAuth(opts.url, token);
  const cloneArgs = [...githubGitConfigArgs(token), "clone", "--depth", "1"];
  if (opts.ref) cloneArgs.push("--branch", opts.ref);
  cloneArgs.push(url, staging);

  const clone = await resolveCommandResult(
    run("git", cloneArgs, { timeoutMs, unattended }),
  );
  if (clone.exitCode !== 0) {
    rmSync(staging, { recursive: true, force: true });
    return {
      ok: false,
      message: mapGitStderr(clone.stderr.trim() || "git clone failed", opts.url),
      ...(isCommandTimeoutStderr(clone.stderr) ? { timedOut: true } : {}),
    };
  }

  const rev = await resolveCommandResult(run("git", [
    ...githubGitConfigArgs(token),
    "-C",
    staging,
    "rev-parse",
    "HEAD",
  ], { timeoutMs, unattended }));
  if (rev.exitCode !== 0) {
    rmSync(staging, { recursive: true, force: true });
    return {
      ok: false,
      message: mapGitStderr(rev.stderr.trim() || "git rev-parse failed", opts.url),
      ...(isCommandTimeoutStderr(rev.stderr) ? { timedOut: true } : {}),
    };
  }

  const backup = `${opts.targetDir}.previous`;
  if (existsSync(backup)) {
    rmSync(backup, { recursive: true, force: true });
  }
  if (existsSync(opts.targetDir)) {
    renameSync(opts.targetDir, backup);
  }
  renameSync(staging, opts.targetDir);
  const previousCatalog = join(backup, "catalog.json");
  const nextCatalog = join(opts.targetDir, "catalog.json");
  if (existsSync(previousCatalog) && !existsSync(nextCatalog)) {
    copyFileSync(previousCatalog, nextCatalog);
  }
  if (existsSync(backup)) {
    rmSync(backup, { recursive: true, force: true });
  }
  return {
    ok: true,
    sha: rev.stdout.trim(),
    message: "Refreshed from git",
  };
}

export function cursorRepoSourceKey(url: string): string {
  return `cursor:repo:${url}`;
}

export function cursorCacheRoot(homeRoot: string): string {
  return join(homeRoot, ".cursor", "plugins", "cache");
}

export function cursorLocalRoot(homeRoot: string): string {
  return join(homeRoot, ".cursor", "plugins", "local");
}

export function cursorMarketplacesRoot(homeRoot: string): string {
  return join(homeRoot, ".cursor", "plugins", "marketplaces");
}

export function cursorProjectsMcpsRoot(homeRoot: string): string {
  return join(homeRoot, ".cursor", "projects", "mcps");
}
