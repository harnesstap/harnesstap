import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_GIT_CLONE_TIMEOUT_MS,
  runCommandWithTimeout,
} from "../services/transport/run-command-with-timeout.js";
import type { RunCommand } from "./run-command.js";

export interface GitRefreshOptions {
  url: string;
  ref?: string;
  targetDir: string;
  runCommand?: RunCommand;
}

export function refreshGitSource(opts: GitRefreshOptions): {
  ok: boolean;
  sha?: string;
  message: string;
} {
  const run = opts.runCommand ?? runCommandWithTimeout;

  if (existsSync(opts.targetDir)) {
    rmSync(opts.targetDir, { recursive: true, force: true });
  }
  mkdirSync(opts.targetDir, { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (opts.ref) cloneArgs.push("--branch", opts.ref);
  cloneArgs.push(opts.url, opts.targetDir);

  const clone = run("git", cloneArgs, { timeoutMs: DEFAULT_GIT_CLONE_TIMEOUT_MS });
  if (clone.exitCode !== 0) {
    return {
      ok: false,
      message: clone.stderr.trim() || "git clone failed",
    };
  }

  const rev = run("git", ["-C", opts.targetDir, "rev-parse", "HEAD"]);
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
