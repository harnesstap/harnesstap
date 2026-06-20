import { spawnSync } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: RunCommandOptions,
) => CommandResult;

export const defaultRunCommand: RunCommand = (command, args, options) => {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options?.cwd,
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.status ?? 1,
  };
};
