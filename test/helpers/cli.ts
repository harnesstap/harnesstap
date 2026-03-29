import { vi } from "vitest";

export interface CliResult {
  stdout: string;
  stderr: string;
  tables: unknown[];
}

function stringifyArgs(args: unknown[]): string {
  return args.map((value) => String(value)).join(" ");
}

export async function runCli(args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const tables: unknown[] = [];
  const originalArgv = [...process.argv];
  const originalExitCode = process.exitCode;

  const logSpy = vi.spyOn(console, "log").mockImplementation((...values) => {
    stdout.push(stringifyArgs(values));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...values) => {
    stderr.push(stringifyArgs(values));
  });
  const tableSpy = vi.spyOn(console, "table").mockImplementation((value) => {
    tables.push(value);
  });

  try {
    process.argv = ["node", "skillset", ...args];
    process.exitCode = undefined;
    vi.resetModules();
    await import("../../src/index.ts");
    return {
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      tables,
    };
  } finally {
    const connection = await import("../../src/db/connection.ts");
    connection.closeDb();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    tableSpy.mockRestore();
  }
}
