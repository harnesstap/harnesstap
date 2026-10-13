import { type ChildProcess, spawn } from "node:child_process";
import type { CommandResult, RunCommandOptions } from "../plugins/run-command.js";

export const DEFAULT_GIT_CLONE_TIMEOUT_MS = 120_000;
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
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

export function resolveCommandTimeoutMs(options?: RunCommandOptions): number | undefined {
  if (options?.unattended) {
    return options.timeoutMs ?? UNATTENDED_GIT_TIMEOUT_MS;
  }
  return options?.timeoutMs;
}

export function spawnCommand(
  command: string,
  args: string[],
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const timeoutMs = resolveCommandTimeoutMs(options);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: command === "git" ? gitCommandEnv(options) : process.env,
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
        finish({
          stdout,
          stderr: `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
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
      finish({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}
