import { access, constants, stat } from "node:fs/promises";
import { defaultRunCommand, type CommandResult, type RunCommand } from "../plugins/run-command.js";
import {
  githubGitConfigArgs,
  githubHttpsRemoteForAuth,
  resolveGithubAccessToken,
} from "./github-credentials.js";
import { normalizeMarketplaceUrl } from "./marketplace-registry.js";
import { GIT_LS_REMOTE_TIMEOUT_MS } from "./marketplace-source-branches.js";

export type MarketplaceReachability =
  | { status: "healthy" }
  | { status: "error"; reason: string };

export interface CheckMarketplaceReachabilityOptions {
  runCommand?: RunCommand;
}

function isLocalFilesystemSource(value: string): boolean {
  if (value.startsWith("file:")) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  if (value.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

export function shortRemoteReachabilityReason(stderr: string): string {
  const line =
    stderr
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0 && !part.toLowerCase().startsWith("warning:")) ?? "";
  const cleaned = line.replace(/^(fatal|error):\s*/i, "");
  const lower = `${cleaned} ${stderr}`.toLowerCase();

  if (
    lower.includes("command not found")
    || lower.includes("enoent")
    || lower.includes("not recognized as an internal")
  ) {
    return "Git is not available";
  }
  if (
    lower.includes("timed out")
    || lower.includes("timeout")
    || lower.includes("stalled")
    || lower.includes("signal: sigterm")
  ) {
    return "Remote check timed out";
  }
  if (
    lower.includes("authentication failed")
    || lower.includes("could not read username")
    || lower.includes("access denied")
    || lower.includes("permission denied")
    || lower.includes("http basic")
    || lower.includes("401")
    || lower.includes("403")
  ) {
    return "Could not authenticate with the remote";
  }
  if (
    lower.includes("repository not found")
    || lower.includes("remote: not found")
    || lower.includes("404")
  ) {
    return "Remote repository was not found";
  }
  if (
    lower.includes("could not resolve host")
    || lower.includes("name or service not known")
    || lower.includes("temporary failure in name resolution")
    || lower.includes("nodename nor servname")
    || lower.includes("network is unreachable")
    || lower.includes("connection refused")
    || lower.includes("failed to connect")
    || lower.includes("unable to access")
    || lower.includes("could not access")
  ) {
    return "Could not reach the remote host";
  }
  return "Could not reach the remote repository";
}

function runGitAsync(
  args: string[],
  runCommand: RunCommand | undefined,
  timeoutMs: number,
): Promise<CommandResult> {
  return Promise.resolve((runCommand ?? defaultRunCommand)("git", args, { timeoutMs }));
}

async function checkLocalPath(path: string): Promise<MarketplaceReachability> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      return { status: "error", reason: "Local path is not a directory" };
    }
    await access(path, constants.R_OK);
    return { status: "healthy" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (code === "ENOENT") {
      return { status: "error", reason: "Local directory is missing" };
    }
    return { status: "error", reason: "Local directory is unreachable" };
  }
}

async function checkRemoteGit(
  url: string,
  runCommand: RunCommand | undefined,
): Promise<MarketplaceReachability> {
  const token = resolveGithubAccessToken().token;
  const remote = githubHttpsRemoteForAuth(url, token);
  const listed = await runGitAsync(
    [...githubGitConfigArgs(token), "ls-remote", "--heads", "--symref", remote],
    runCommand,
    GIT_LS_REMOTE_TIMEOUT_MS,
  );
  if (listed.exitCode === 0) {
    return { status: "healthy" };
  }
  return {
    status: "error",
    reason: shortRemoteReachabilityReason(listed.stderr),
  };
}

export async function checkMarketplaceReachability(
  source: string,
  options: CheckMarketplaceReachabilityOptions = {},
): Promise<MarketplaceReachability> {
  const trimmed = source.trim();
  if (!trimmed) {
    return { status: "error", reason: "Marketplace URL or path is required" };
  }

  if (isLocalFilesystemSource(trimmed)) {
    const path = normalizeMarketplaceUrl(trimmed);
    if (!path) {
      return { status: "error", reason: "Marketplace URL or path is required" };
    }
    return checkLocalPath(path);
  }

  const url = normalizeMarketplaceUrl(trimmed);
  if (!url) {
    return { status: "error", reason: "Marketplace URL or path is required" };
  }
  return checkRemoteGit(url, options.runCommand);
}

export async function checkMarketplacesReachability(
  entries: readonly { name: string; url: string }[],
  options: CheckMarketplaceReachabilityOptions = {},
): Promise<Record<string, MarketplaceReachability>> {
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const result = await checkMarketplaceReachability(entry.url, options);
      return [entry.name, result] as const;
    }),
  );
  return Object.fromEntries(rows);
}
