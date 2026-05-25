import { vi } from "vitest";

export interface CliResult {
  stdout: string;
  stderr: string;
  tables: unknown[];
  exitCode?: number;
}

export interface RunCliOptions {
  commandName?: string;
}

function stringifyArgs(args: unknown[]): string {
  return args.map((value) => String(value)).join(" ");
}

let cliImportCounter = 0;

async function importCliEntry(): Promise<void> {
  const cacheBuster = `test=${Date.now()}-${cliImportCounter++}`;
  await import(/* @vite-ignore */ `../../src/index.ts?${cacheBuster}`);
}

export async function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const tables: unknown[] = [];
  const originalArgv = [...process.argv];
  const originalExitCode = process.exitCode;
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  
  // Import chalk dynamically to capture its level before test
  const chalkModule = await import("chalk");
  const originalChalkLevel = chalkModule.default.level;

  const logSpy = vi.spyOn(console, "log").mockImplementation((...values) => {
    stdout.push(stringifyArgs(values));
  });
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...values) => {
      stderr.push(stringifyArgs(values));
    });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...values) => {
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
    process.argv = ["node", options.commandName ?? "harnessdeck", ...args];
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
      exitCode: process.exitCode,
    };
  } finally {
    const connection = await import("../../src/db/connection.ts");
    connection.closeDb();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    
    // Restore environment variables
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    
    // Restore chalk level
    chalkModule.default.level = originalChalkLevel;
    
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    tableSpy.mockRestore();
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
  }
}

/**
 * Validates that the runCli harness captures UI renderer output produced via
 * console.log and console.error. Use in integration tests to assert end-to-end
 * capture is working, e.g.:
 *
 *   const result = await runCli(["-h"]);
 *   expect(result.stdout.length).toBeGreaterThan(0);
 */
export async function assertCliOutputCaptured(args: string[] = ["-h"]): Promise<CliResult> {
  const result = await runCli(args);
  if (result.stdout.length === 0 && result.stderr.length === 0) {
    throw new Error(
      "runCli harness captured no output; console.log/error from UI renderers may not be reaching the spies.",
    );
  }
  return result;
}
