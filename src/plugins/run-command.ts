import { spawnCommand } from "../utils/spawn-command.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Background git fetch: short timeout and SSH connect limit. */
  unattended?: boolean;
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: RunCommandOptions,
) => CommandResult | Promise<CommandResult>;

export async function resolveCommandResult(
  result: CommandResult | Promise<CommandResult>,
): Promise<CommandResult> {
  return await result;
}

export const defaultRunCommand: RunCommand = (command, args, options) => {
  return spawnCommand(command, args, options);
};
