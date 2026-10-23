import { execFileSync } from "node:child_process";

/**
 * Limits for every git call that talks to a remote (clone, fetch, ls-remote)
 * and for the `claude plugin` calls that run git on HarnessTap's behalf.
 * A remote that stops answering must end in a clear error, not a hang.
 */

/** Seconds a git network call may run before HarnessTap stops it. */
export const GIT_TIMEOUT_ENV = "HARNESSTAP_GIT_TIMEOUT_SECONDS";
export const DEFAULT_GIT_NETWORK_TIMEOUT_MS = 60_000;
/** `claude plugin` clones whole marketplaces, so it gets a longer overall limit. */
export const DEFAULT_CLAUDE_PLUGIN_TIMEOUT_MS = 600_000;
/** git gives up when a transfer stays under this many bytes per second ... */
export const DEFAULT_GIT_LOW_SPEED_LIMIT = "1000";
/** ... for this many seconds. */
export const DEFAULT_GIT_LOW_SPEED_TIME = "30";

const NETWORK_SUBCOMMANDS = new Set(["clone", "fetch", "ls-remote", "pull", "push"]);
const OPTIONS_WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace"]);
const SUBCOMMAND_OPTIONS_WITH_VALUE = new Set([
  "-b", "--branch", "--depth", "-o", "--origin", "--config", "--reference", "--filter",
  "-j", "--jobs", "--template", "-u", "--upload-pack", "--shallow-since", "--shallow-exclude",
  "--separate-git-dir", "--server-option",
]);

/** The timeout set through HARNESSTAP_GIT_TIMEOUT_SECONDS, when it is a positive number. */
export function gitTimeoutOverrideMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[GIT_TIMEOUT_ENV]?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.round(seconds * 1000);
}

/** The git subcommand and the arguments after it, skipping `-c k=v` style global options. */
export function gitSubcommand(args: string[]): { name: string; rest: string[] } | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (OPTIONS_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { name: arg, rest: args.slice(i + 1) };
  }
  return undefined;
}

export function isGitNetworkCommand(args: string[]): boolean {
  const sub = gitSubcommand(args);
  return sub !== undefined && NETWORK_SUBCOMMANDS.has(sub.name);
}

export function isClaudePluginCommand(command: string, args: string[]): boolean {
  const base = command.split(/[\\/]/).pop() ?? command;
  return /^claude(\.exe|\.cmd)?$/.test(base) && args[0] === "plugin";
}

/** Drop credentials from a remote so an error can name it safely. */
export function redactRemote(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
}

function positionalArgs(rest: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? "";
    if (SUBCOMMAND_OPTIONS_WITH_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) out.push(arg);
  }
  return out;
}

function gitDirFromArgs(args: string[], cwd: string | undefined): string | undefined {
  const at = args.indexOf("-C");
  return at >= 0 && args[at + 1] ? args[at + 1] : cwd;
}

/**
 * The repository a git network call is about: its URL or path without credentials.
 * A named remote such as `origin` is looked up in the repository the call runs in.
 */
export function gitRemoteFromArgs(args: string[], cwd?: string): string | undefined {
  const sub = gitSubcommand(args);
  if (!sub || !NETWORK_SUBCOMMANDS.has(sub.name)) return undefined;
  const remote = positionalArgs(sub.rest)[0] ?? (sub.name === "clone" ? undefined : "origin");
  if (!remote) return undefined;
  if (/[/:\\]/.test(remote)) return redactRemote(remote);
  const dir = gitDirFromArgs(args, cwd);
  if (!dir) return remote;
  try {
    const url = execFileSync("git", ["-C", dir, "remote", "get-url", remote], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
    return url ? redactRemote(url) : remote;
  } catch {
    return remote;
  }
}

/** Add git's own stall detection to an environment, keeping a value the user already set. */
export function withGitLowSpeedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_HTTP_LOW_SPEED_LIMIT: env.GIT_HTTP_LOW_SPEED_LIMIT ?? DEFAULT_GIT_LOW_SPEED_LIMIT,
    GIT_HTTP_LOW_SPEED_TIME: env.GIT_HTTP_LOW_SPEED_TIME ?? DEFAULT_GIT_LOW_SPEED_TIME,
  };
}

function seconds(ms: number): string {
  const value = ms / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The message for a git or claude call that ran past its limit. */
export function gitTimeoutMessage(command: string, args: string[], timeoutMs: number, cwd?: string): string {
  const remote = gitRemoteFromArgs(args, cwd);
  const hint = `Set ${GIT_TIMEOUT_ENV} to allow more time.`;
  if (command === "git") {
    const sub = gitSubcommand(args)?.name ?? "command";
    const target = remote ? ` for ${remote}` : "";
    return `git ${sub} timed out after ${seconds(timeoutMs)}s${target}. The remote did not answer in time. ${hint}`;
  }
  const shown = args.map(redactRemote).join(" ");
  return `${command} ${shown} timed out after ${seconds(timeoutMs)}s while git fetched from a remote. ${hint}`;
}

/**
 * git's own abort for a stalled transfer ("Operation too slow"), rewritten to name the
 * repository. Returns undefined for any other failure.
 */
export function gitStallMessage(args: string[], stderr: string, cwd?: string): string | undefined {
  if (!/operation too slow|less than \d+ bytes\/sec/i.test(stderr)) return undefined;
  const remote = gitRemoteFromArgs(args, cwd);
  const sub = gitSubcommand(args)?.name ?? "command";
  const target = remote ? ` for ${remote}` : "";
  return `git ${sub} stalled${target}: the remote stopped sending data and git gave up. Try again, or check the network.`;
}
