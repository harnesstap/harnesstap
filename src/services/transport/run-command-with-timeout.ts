import { spawnSync } from "node:child_process";
import type { CommandResult, RunCommandOptions } from "../../plugins/run-command.js";

export const DEFAULT_GIT_CLONE_TIMEOUT_MS = 120_000;

export interface RunCommandWithTimeoutOptions extends RunCommandOptions {
  timeoutMs?: number;
}

export function runCommandWithTimeout(
  command: string,
  args: string[],
  options?: RunCommandWithTimeoutOptions,
): CommandResult {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GIT_CLONE_TIMEOUT_MS;
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options?.cwd,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });

  if (result.error?.code === "ETIMEDOUT") {
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`,
      exitCode: 124,
    };
  }

  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.status ?? 1,
  };
}
