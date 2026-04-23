import { vi } from "vitest";

export interface CliResult {
  stdout: string;
  stderr: string;
  tables: unknown[];
}

function stringifyArgs(args: unknown[]): string {
  return args.map((value) => String(value)).join(" ");
}

let cliImportCounter = 0;

async function importCliEntry(): Promise<void> {
  const cacheBuster = `test=${Date.now()}-${cliImportCounter++}`;
  await import(/* @vite-ignore */ `../../src/index.ts?${cacheBuster}`);
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
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...values) => {
      stderr.push(stringifyArgs(values));
    });
  const tableSpy = vi.spyOn(console, "table").mockImplementation((value) => {
    tables.push(value);
  });
  const stdoutWriteSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
  const stderrWriteSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });

  try {
    process.argv = ["node", "harnessdeck", ...args];
    process.exitCode = undefined;
    try {
      await importCliEntry();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'process.exit unexpectedly called with "0"'
      ) {
        throw error;
      }
    }
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
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
  }
}
