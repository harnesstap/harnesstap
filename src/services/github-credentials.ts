import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  loadGithubSession,
  saveGithubSession,
  type GithubSession,
} from "../config/github-session.js";
import { resolveGithubAppClientSecret } from "../config/github-app.js";
import type { RunCommand } from "../plugins/run-command.js";
import {
  refreshGithubAccessToken,
  sessionFromDeviceToken,
} from "./github-device-flow.js";

export type GithubTokenSource =
  | "harnesstap_github_token"
  | "gh_token"
  | "github_token"
  | "harnesstap_session"
  | "gh_cli"
  | "none";

export interface GithubTokenResolution {
  token: string | null;
  source: GithubTokenSource;
}

export interface ResolveGithubTokenOptions {
  env?: NodeJS.ProcessEnv;
  session?: GithubSession | null;
  nowSeconds?: number;
  lookupGhCli?: boolean;
  runCommand?: RunCommand;
}

const ENV_SOURCES = [
  { key: "HARNESSTAP_GITHUB_TOKEN", source: "harnesstap_github_token" as const },
  { key: "GH_TOKEN", source: "gh_token" as const },
  { key: "GITHUB_TOKEN", source: "github_token" as const },
] as const;

let ghCliTokenCache: { token: string | null } | undefined;

export function resetGithubTokenLookups(): void {
  ghCliTokenCache = undefined;
}

function envToken(
  env: NodeJS.ProcessEnv,
): { token: string; source: GithubTokenSource } | null {
  for (const entry of ENV_SOURCES) {
    const value = env[entry.key]?.trim();
    if (value) {
      return { token: value, source: entry.source };
    }
  }
  return null;
}

function sessionTokenUsable(
  session: GithubSession | null | undefined,
  nowSeconds: number,
): string | null {
  if (!session?.accessToken) {
    return null;
  }
  if (
    typeof session.accessTokenExpiresAt === "number"
    && session.accessTokenExpiresAt <= nowSeconds + 30
  ) {
    return null;
  }
  return session.accessToken;
}

function readGhCliToken(runCommand?: RunCommand): string | null {
  if (ghCliTokenCache) {
    return ghCliTokenCache.token;
  }
  try {
    const result = runCommand
      ? runCommand("gh", ["auth", "token"], { timeoutMs: 3000 })
      : spawnSync("gh", ["auth", "token"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 3000,
        });
    const exitCode = "exitCode" in result
      ? result.exitCode
      : (result.status ?? 1);
    const stdout = result.stdout?.toString() ?? "";
    const token = exitCode === 0 ? stdout.trim() : "";
    ghCliTokenCache = { token: token.length > 0 ? token : null };
    return ghCliTokenCache.token;
  } catch {
    ghCliTokenCache = { token: null };
    return null;
  }
}

export function resolveGithubAccessToken(
  opts: ResolveGithubTokenOptions = {},
): GithubTokenResolution {
  const env = opts.env ?? process.env;
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const fromEnv = envToken(env);
  if (fromEnv) {
    return fromEnv;
  }

  const session = opts.session === undefined ? loadGithubSession() : opts.session;
  const fromSession = sessionTokenUsable(session, nowSeconds);
  if (fromSession) {
    return { token: fromSession, source: "harnesstap_session" };
  }

  if (opts.lookupGhCli !== false) {
    const fromGh = readGhCliToken(opts.runCommand);
    if (fromGh) {
      return { token: fromGh, source: "gh_cli" };
    }
  }

  return { token: null, source: "none" };
}

export async function ensureGithubSessionAccess(
  opts: ResolveGithubTokenOptions = {},
): Promise<GithubSession | null> {
  const env = opts.env ?? process.env;
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const session = opts.session === undefined ? loadGithubSession() : opts.session;
  if (!session?.accessToken) {
    return null;
  }
  if (sessionTokenUsable(session, nowSeconds)) {
    return session;
  }
  if (!session.refreshToken || !resolveGithubAppClientSecret(env)) {
    return null;
  }
  try {
    const token = await refreshGithubAccessToken(session.refreshToken, { env });
    const next = sessionFromDeviceToken(token, {
      login: session.login ?? "",
      id: session.userId ?? 0,
      ...(session.name ? { name: session.name } : {}),
    }, { env, now: () => nowSeconds * 1000 });
    const merged: GithubSession = {
      ...session,
      ...next,
      login: next.login || session.login,
      userId: next.userId || session.userId,
      name: next.name ?? session.name,
    };
    saveGithubSession(merged);
    return merged;
  } catch {
    return null;
  }
}

/**
 * Git HTTPS Authorization extraheader for GitHub tokens (PAT, OAuth, App
 * user-to-server `ghu_`, installation `ghs_`). GitHub git-over-HTTP expects
 * Basic `x-access-token:TOKEN`, not Bearer. A rejected Bearer is worse than
 * anonymous access for public remotes.
 */
export function githubGitHttpAuthorizationHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

export function githubGitConfigArgs(token: string | null | undefined): string[] {
  const args = ["-c", "protocol.file.allow=always"];
  if (!token) {
    return args;
  }
  const sanitized = token.replace(/[\r\n]/g, "");
  if (!sanitized) {
    return args;
  }
  const extraHeader = `http.https://github.com/.extraheader=${githubGitHttpAuthorizationHeader(sanitized)}`;
  // Clear any inherited extraheader, then set ours (same pattern as `gh`).
  args.push("-c", "http.https://github.com/.extraheader=", "-c", extraHeader);
  return args;
}

/** Prepend GitHub HTTP auth config unless `args` already start with `-c`. */
export function ensureGithubGitConfigArgs(args: string[]): string[] {
  if (args[0] === "-c") {
    return args;
  }
  return [...githubGitConfigArgs(resolveGithubAccessToken().token), ...args];
}

const GITHUB_SCP =
  /^(?:ssh:\/\/)?(?:[^@/\s]+@)?(github\.com|gist\.github\.com)[:/](.+)$/i;

export function githubHttpsRemoteForAuth(
  url: string,
  token: string | null | undefined,
): string {
  if (!token) {
    return url;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return url;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      && (parsed.hostname === "github.com"
        || parsed.hostname === "www.github.com"
        || parsed.hostname === "gist.github.com")
    ) {
      return trimmed;
    }
  } catch {
    // SCP / git@ form
  }
  const scp = trimmed.match(GITHUB_SCP);
  if (scp?.[1] && scp[2]) {
    const path = scp[2].replace(/^\/+/, "").replace(/\.git$/i, "");
    return `https://${scp[1]}/${path}.git`;
  }
  return url;
}
