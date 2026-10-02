import { existsSync } from "node:fs";
import type { RunCommand } from "../plugins/run-command.js";
import { runCommandWithTimeout } from "../utils/run-command-with-timeout.js";
import { normalizeMarketplaceUrl } from "./marketplace-registry.js";

export const GIT_LS_REMOTE_TIMEOUT_MS = 20_000;

export interface MarketplaceSourceBranches {
  branches: string[];
  defaultBranch: string | null;
}

const FILE_PROTOCOL_ARGS = ["-c", "protocol.file.allow=always"] as const;

export function parseGitHeadSymref(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*ref:\s+refs\/heads\/(\S+)/.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function parseGitLsRemoteHeads(stdout: string): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /\trefs\/heads\/(.+)$/.exec(line);
    const name = match?.[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    branches.push(name);
  }
  return branches;
}

export function parseGitForEachRefHeads(stdout: string): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];
  for (const part of stdout.split(/\r?\n/)) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    branches.push(name);
  }
  return branches;
}

function runGit(
  runCommand: RunCommand | undefined,
  args: string[],
): ReturnType<RunCommand> {
  const run =
    runCommand
    ?? ((command, commandArgs, options) =>
      runCommandWithTimeout(command, commandArgs, {
        ...options,
        timeoutMs: GIT_LS_REMOTE_TIMEOUT_MS,
      }));
  return run("git", args);
}

function gitFailed(stderr: string, fallback: string): never {
  throw new Error(stderr.trim() || fallback);
}

function listLocalBranches(
  dir: string,
  runCommand: RunCommand | undefined,
): MarketplaceSourceBranches {
  const listed = runGit(runCommand, [
    ...FILE_PROTOCOL_ARGS,
    "-C",
    dir,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  if (listed.exitCode !== 0) {
    gitFailed(listed.stderr, "Could not list local git branches");
  }
  const head = runGit(runCommand, [
    ...FILE_PROTOCOL_ARGS,
    "-C",
    dir,
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  const name = head.stdout.trim();
  const defaultBranch =
    head.exitCode === 0 && name && name !== "HEAD" ? name : null;
  return {
    branches: parseGitForEachRefHeads(listed.stdout),
    defaultBranch,
  };
}

function listRemoteBranches(
  url: string,
  runCommand: RunCommand | undefined,
): MarketplaceSourceBranches {
  const listed = runGit(runCommand, [
    ...FILE_PROTOCOL_ARGS,
    "ls-remote",
    "--heads",
    "--symref",
    url,
  ]);
  if (listed.exitCode !== 0) {
    gitFailed(listed.stderr, "Could not list remote git branches");
  }
  return {
    branches: parseGitLsRemoteHeads(listed.stdout),
    defaultBranch: parseGitHeadSymref(listed.stdout),
  };
}

export function listMarketplaceSourceBranches(
  source: string,
  runCommand?: RunCommand,
): MarketplaceSourceBranches {
  const url = normalizeMarketplaceUrl(source);
  if (!url) {
    throw new Error("Marketplace URL or path is required");
  }
  if (existsSync(url)) {
    return listLocalBranches(url, runCommand);
  }
  return listRemoteBranches(url, runCommand);
}
