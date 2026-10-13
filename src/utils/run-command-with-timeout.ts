import type { CommandResult, RunCommandOptions } from "../plugins/run-command.js";
import {
  DEFAULT_GIT_CLONE_TIMEOUT_MS,
  spawnCommand,
} from "./spawn-command.js";

export { DEFAULT_GIT_CLONE_TIMEOUT_MS, UNATTENDED_GIT_TIMEOUT_MS } from "./spawn-command.js";

export interface RunCommandWithTimeoutOptions extends RunCommandOptions {
  timeoutMs?: number;
}

export function runCommandWithTimeout(
  command: string,
  args: string[],
  options?: RunCommandWithTimeoutOptions,
): Promise<CommandResult> {
  const timeoutMs = options?.unattended
    ? options.timeoutMs
    : (options?.timeoutMs ?? DEFAULT_GIT_CLONE_TIMEOUT_MS);
  return spawnCommand(command, args, {
    ...options,
    timeoutMs,
  });
}
