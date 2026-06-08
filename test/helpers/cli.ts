import { ExitPromptError } from "@inquirer/core";
import inquirer from "inquirer";
import search from "@inquirer/search";
import { mock, spyOn } from "bun:test";
import type { promptForSearchableMultiSelect as SearchableMultiSelectPrompt } from "../../src/services/wizards/searchable-multi-select.js";
import type { runResourceListWizard as RunResourceListWizard } from "../../src/services/wizards/resource-list.js";
import type { runInteractiveCatalogBrowser as RunInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.js";

export interface CliResult {
  stdout: string;
  stderr: string;
  tables: unknown[];
  exitCode?: number;
}

export interface RunCliOptions {
  commandName?: string;
  isTTY?: boolean;
  env?: Record<string, string | undefined>;
  promptResponses?: Array<Record<string, unknown>>;
}

let activePromptResponses: Array<Record<string, unknown>> = [];
let runCliHarnessActive = false;

function shiftPromptResponse(): Record<string, unknown> {
  const next = activePromptResponses.shift();
  if (!next) {
    throw new Error("Unexpected interactive prompt in runCli test harness");
  }
  return next;
}

function throwIfPromptCancelled(response: Record<string, unknown>): void {
  if (response.__promptCancel === true) {
    throw new ExitPromptError("User force closed the prompt with SIGINT");
  }
}

function shiftSinglePromptValue(): unknown {
  const next = shiftPromptResponse();
  throwIfPromptCancelled(next);
  const values = Object.values(next);
  if (values.length !== 1) {
    throw new Error(
      "Search prompt responses must provide exactly one value in runCli test harness",
    );
  }
  return values[0];
}

const promptMock = mock(async (...args: Parameters<typeof inquirer.prompt>) => {
  if (!runCliHarnessActive) {
    return inquirer.prompt(...args);
  }
  const next = shiftPromptResponse();
  throwIfPromptCancelled(next);
  return next;
});
const searchPromptMock = mock(async (...args: Parameters<typeof search>) => {
  if (!runCliHarnessActive) {
    return search(...args);
  }
  const value = shiftSinglePromptValue();
  if (typeof value !== "string") {
    throw new Error(
      "Search prompt responses must resolve to a string in runCli test harness",
    );
  }
  return value;
});
const searchableMultiSelectMock = mock(async (
  ...args: Parameters<typeof SearchableMultiSelectPrompt>
) => {
  if (!runCliHarnessActive) {
    const actualPromptModule = await import(
      "../../src/services/wizards/searchable-multi-select.ts?actual"
    );
    return actualPromptModule.promptForSearchableMultiSelect(...args);
  }
  const value = shiftSinglePromptValue();
  if (!Array.isArray(value)) {
    throw new Error(
      "Multi-select prompt responses must resolve to an array in runCli test harness",
    );
  }
  return value;
});

mock.module("inquirer", () => ({
  default: {
    prompt: promptMock,
  },
}));

mock.module("@inquirer/search", () => ({
  default: searchPromptMock,
}));

mock.module("../../src/services/wizards/searchable-multi-select.js", () => ({
  promptForSearchableMultiSelect: searchableMultiSelectMock,
}));

const resourceListWizardMock = mock(async (
  ...args: Parameters<typeof RunResourceListWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/resource-list.ts?actual"
    );
    return actualWizard.runResourceListWizard(...args);
  }
  const value = shiftSinglePromptValue();
  if (typeof value === "string") {
    return value.length > 0 ? { search: value } : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const query = typeof record.query === "string"
      ? record.query
      : typeof record.search === "string"
        ? record.search
        : "";
    if (!query) {
      return undefined;
    }
    return { search: query };
  }
  throw new Error(
    "Resource list wizard responses must resolve to a string query or result object in runCli test harness",
  );
});

mock.module("../../src/services/wizards/resource-list.js", () => ({
  runResourceListWizard: resourceListWizardMock,
}));

const interactiveCatalogBrowserMock = mock(async (
  ...args: Parameters<typeof RunInteractiveCatalogBrowser>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/interactive-catalog-browser.ts?actual"
    );
    return actualWizard.runInteractiveCatalogBrowser(...args);
  }
  const value = shiftSinglePromptValue();
  if (typeof value === "string") {
    const [orgSlug, slug] = value.split("/");
    return { orgSlug, slug, version: "1.0.0" };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.orgSlug === "string" && typeof record.slug === "string") {
      return {
        orgSlug: record.orgSlug,
        slug: record.slug,
        version: typeof record.version === "string" ? record.version : "1.0.0",
      };
    }
  }
  throw new Error(
    "Interactive catalog browser responses must resolve to org/library string or selection object",
  );
});

mock.module("../../src/services/wizards/interactive-catalog-browser.js", () => ({
  runInteractiveCatalogBrowser: interactiveCatalogBrowserMock,
}));

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
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStdinIsTTY = process.stdin.isTTY;
  const effectiveIsTTY = options.isTTY ?? false;
  const envOverrides = {
    CI: undefined,
    HARNESSDECK_NO_INTERACTIVE: undefined,
    ...(options.env ?? {}),
  };
  const envEntries = Object.entries(envOverrides);
  const originalEnv = new Map(
    envEntries.map(([key]) => [key, process.env[key]]),
  );

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

    Object.defineProperty(process.stdin, "isTTY", {
      value: effectiveIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: effectiveIsTTY,
      configurable: true,
    });

    for (const [key, value] of envEntries) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    activePromptResponses = [...(options.promptResponses ?? [])];
    runCliHarnessActive = true;
    promptMock.mockClear();
    searchPromptMock.mockClear();
    searchableMultiSelectMock.mockClear();

    const { runHarnessdeckCli } = await import("../../src/index.ts");
    await runHarnessdeckCli(process.argv);

    if (activePromptResponses.length > 0) {
      throw new Error(
        `Unused prompt responses in runCli test harness: ${activePromptResponses.length}`,
      );
    }

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

    Object.defineProperty(process.stdin, "isTTY", {
      value: originalStdinIsTTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });

    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    chalkModule.default.level = originalChalkLevel;
    activePromptResponses = [];
    runCliHarnessActive = false;

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
