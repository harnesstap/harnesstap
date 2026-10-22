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
import { mapGitStderr } from "../utils/git-errors.js";
import { resolveCommandResult, type RunCommand } from "./run-command.js";

export interface GitRefreshOptions {
  url: string;
  ref?: string;
  targetDir: string;
  runCommand?: RunCommand;
  /** Background catalog refresh. Shorter timeout, no prompt, SSH connect limit. */
  unattended?: boolean;
}

const COMMIT_LIKE = /^[0-9a-f]{7,40}$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;

type GitRunner = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

async function checkoutCommit(
  git: GitRunner,
  url: string,
  staging: string,
  sha: string,
): Promise<{ ok: boolean; message: string }> {
  if (FULL_SHA.test(sha)) {
    const init = await git(["init", "--quiet", staging]);
    if (init.exitCode === 0) {
      const remote = await git(["-C", staging, "remote", "add", "origin", url]);
      const fetch = remote.exitCode === 0
        ? await git(["-C", staging, "fetch", "--depth", "1", "origin", sha])
        : remote;
      if (fetch.exitCode === 0) {
        const checkout = await git(["-C", staging, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
        if (checkout.exitCode === 0) return { ok: true, message: "" };
      }
    }
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
  }
  const clone = await git(["clone", "--quiet", "--no-checkout", url, staging]);
  if (clone.exitCode !== 0) {
    return { ok: false, message: clone.stderr.trim() || "git clone failed" };
  }
  const resolved = await git(["-C", staging, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  if (resolved.exitCode !== 0 || !resolved.stdout.trim()) {
    return { ok: false, message: `Commit ${sha} was not found in ${url}` };
  }
  const checkout = await git(["-C", staging, "checkout", "--quiet", "--detach", resolved.stdout.trim()]);
  if (checkout.exitCode !== 0) {
    return { ok: false, message: checkout.stderr.trim() || `git checkout ${sha} failed` };
  }
  return { ok: true, message: "" };
}

export async function refreshGitSource(opts: GitRefreshOptions): Promise<{
  ok: boolean;
  sha?: string;
  message: string;
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
  const git = (args: string[]) =>
    resolveCommandResult(run("git", [...githubGitConfigArgs(token), ...args], { timeoutMs, unattended }));
  const fail = (message: string) => {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, message };
  };

  const ref = opts.ref?.trim() || undefined;
  let cloned = false;
  let lastError = "git clone failed";
  if (ref && COMMIT_LIKE.test(ref)) {
    // A commit cannot be cloned with --branch (#500). Fetch it by SHA, or
    // clone the history and check it out when the server refuses that or
    // the SHA is abbreviated.
    const checkedOut = await checkoutCommit(git, url, staging, ref);
    if (checkedOut.ok) {
      cloned = true;
    } else {
      lastError = checkedOut.message;
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
    }
  }
  if (!cloned) {
    const cloneArgs = ["clone", "--depth", "1"];
    if (ref) cloneArgs.push("--branch", ref);
    cloneArgs.push(url, staging);
    const clone = await git(cloneArgs);
    if (clone.exitCode !== 0) {
      const stderr = clone.stderr.trim();
      if (ref && /not found|did not match|Remote branch .* not found/i.test(stderr || lastError)) {
        return fail(`Git ref ${ref} was not found in ${opts.url}`);
      }
      return fail(mapGitStderr(stderr || lastError, opts.url));
    }
  }

  const rev = await git(["-C", staging, "rev-parse", "HEAD"]);
  if (rev.exitCode !== 0) {
    return fail(mapGitStderr(rev.stderr.trim() || "git rev-parse failed", opts.url));
  }
  if (ref && COMMIT_LIKE.test(ref) && cloned && !rev.stdout.trim().toLowerCase().startsWith(ref.toLowerCase())) {
    return fail(`Checked out ${rev.stdout.trim()} instead of pinned commit ${ref} from ${opts.url}`);
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
