import { spyOn } from "bun:test";

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

export async function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<CliResult> {
  const connection = await import("../../src/db/connection.ts");
  connection.closeDb();

  const stdout: string[] = [];
  const stderr: string[] = [];
  const tables: unknown[] = [];
  const originalArgv = [...process.argv];
  const originalExitCode = process.exitCode;
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  const chalkModule = await import("chalk");
  const originalChalkLevel = chalkModule.default.level;

  const logSpy = spyOn(console, "log").mockImplementation((...values) => {
    stdout.push(stringifyArgs(values));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...values) => {
    stderr.push(stringifyArgs(values));
  });
  const warnSpy = spyOn(console, "warn").mockImplementation((...values) => {
    stderr.push(stringifyArgs(values));
  });
  const tableSpy = spyOn(console, "table").mockImplementation((value) => {
    tables.push(value);
  });
  const stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    },
  );
  const stderrWriteSpy = spyOn(process.stderr, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    },
  );

  try {
    process.argv = ["node", options.commandName ?? "harnessdeck", ...args];
    process.exitCode = 0;
    process.env.FORCE_COLOR = "0";
    process.env.NO_COLOR = "1";

    const { runHarnessdeckCli } = await import("../../src/index.ts");
    await runHarnessdeckCli(process.argv);

    const exitCode = process.exitCode;
    return {
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      tables,
      exitCode: exitCode === 0 ? undefined : exitCode,
    };
  } finally {
    connection.closeDb();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;

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
 * console.log and console.error.
 */
export async function assertCliOutputCaptured(
  args: string[] = ["-h"],
): Promise<CliResult> {
  const result = await runCli(args);
  if (result.stdout.length === 0 && result.stderr.length === 0) {
    throw new Error(
      "runCli harness captured no output; console.log/error from UI renderers may not be reaching the spies.",
    );
  }
  return result;
}
