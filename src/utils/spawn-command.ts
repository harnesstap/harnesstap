import { type ChildProcess, spawn } from "node:child_process";
import type { CommandResult, RunCommandOptions } from "../plugins/run-command.js";
import {
  DEFAULT_CLAUDE_PLUGIN_TIMEOUT_MS,
  DEFAULT_GIT_NETWORK_TIMEOUT_MS,
  gitStallMessage,
  gitTimeoutMessage,
  gitTimeoutOverrideMs,
  isClaudePluginCommand,
  isGitNetworkCommand,
  withGitLowSpeedEnv,
} from "./git-network.js";

export const DEFAULT_GIT_CLONE_TIMEOUT_MS = DEFAULT_GIT_NETWORK_TIMEOUT_MS;
export const UNATTENDED_GIT_TIMEOUT_MS = 15_000;
export const UNATTENDED_SSH_CONNECT_TIMEOUT_SEC = 15;

const inflightChildren = new Set<ChildProcess>();

export function inflightCommandCount(): number {
  return inflightChildren.size;
}

/** Stop git and opener children started by this process. Used by tests. */
export function stopInflightCommands(): void {
  for (const child of inflightChildren) {
    child.kill("SIGTERM");
  }
  inflightChildren.clear();
}

export function gitCommandEnv(options?: { unattended?: boolean }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = withGitLowSpeedEnv({
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  });
  if (!options?.unattended) {
    return env;
  }
  const existing = process.env.GIT_SSH_COMMAND?.trim();
  const base = existing && existing.length > 0 ? existing : "ssh";
  const withTimeout = /\bConnectTimeout=/.test(base)
    ? base
    : `${base} -o ConnectTimeout=${UNATTENDED_SSH_CONNECT_TIMEOUT_SEC}`;
  env.GIT_SSH_COMMAND = /\bBatchMode=/.test(withTimeout)
    ? withTimeout
    : `${withTimeout} -o BatchMode=yes`;
  return env;
}

/**
 * The limit for a command. A git network call or a `claude plugin` call, which
 * runs git, always has one: HARNESSTAP_GIT_TIMEOUT_SECONDS when set, else the
 * caller's value, else the default. Background (unattended) calls keep their short limit.
 */
export function resolveCommandTimeoutMs(
  options?: RunCommandOptions,
  command?: string,
  args: string[] = [],
): number | undefined {
  if (options?.unattended) {
    return options.timeoutMs ?? UNATTENDED_GIT_TIMEOUT_MS;
  }
  const override = gitTimeoutOverrideMs();
  if (command === "git" && isGitNetworkCommand(args)) {
    return override ?? options?.timeoutMs ?? DEFAULT_GIT_NETWORK_TIMEOUT_MS;
  }
  if (command !== undefined && isClaudePluginCommand(command, args)) {
    return Math.max(override ?? 0, options?.timeoutMs ?? DEFAULT_CLAUDE_PLUGIN_TIMEOUT_MS);
  }
  return options?.timeoutMs;
}

function commandEnv(command: string, args: string[], options?: RunCommandOptions): NodeJS.ProcessEnv {
  if (command === "git") return gitCommandEnv(options);
  if (isClaudePluginCommand(command, args)) return withGitLowSpeedEnv(process.env);
  return process.env;
}

export function spawnCommand(
  command: string,
  args: string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const timeoutMs = resolveCommandTimeoutMs(options, command, args);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: commandEnv(command, args, options),
      stdio: ["ignore", "pipe", "pipe"],
    });
    inflightChildren.add(child);

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      inflightChildren.delete(child);
      resolve(result);
    };

    const timer = timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        child.kill("SIGTERM");
        // A grandchild such as git remote-https can keep the pipes open after the kill.
        child.stdout?.destroy();
        child.stderr?.destroy();
        const watched = (command === "git" && isGitNetworkCommand(args)) || isClaudePluginCommand(command, args);
        finish({
          stdout,
          stderr: watched
            ? gitTimeoutMessage(command, args, timeoutMs, options?.cwd)
            : `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
          exitCode: 124,
        });
      }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      const missing = "code" in error && error.code === "ENOENT";
      finish({
        stdout,
        stderr: missing
          ? `${command}: command not found`
          : error.message,
        exitCode: missing ? 127 : 1,
      });
    });
    child.on("close", (code) => {
      const stalled = code !== 0 && command === "git" ? gitStallMessage(args, stderr, options?.cwd) : undefined;
      finish({
        stdout,
        stderr: stalled ?? stderr,
        exitCode: code ?? 1,
      });
    });
  });
}
