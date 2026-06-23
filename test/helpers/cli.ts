import { ExitPromptError } from "@inquirer/core";
import inquirer from "inquirer";
import search from "@inquirer/search";
import { mock, spyOn } from "bun:test";
import type { runEnvironmentDeleteWizard as RunEnvironmentDeleteWizard } from "../../src/services/wizards/environment-delete.js";
import type { runEnvironmentShowWizard as RunEnvironmentShowWizard } from "../../src/services/wizards/environment-show.js";
import type { runResourceDeleteWizard as RunResourceDeleteWizard } from "../../src/services/wizards/resource-delete.js";
import type { runLayerShowWizard as RunLayerShowWizard } from "../../src/services/wizards/layer-show.js";
import type { runResourceListWizard as RunResourceListWizard } from "../../src/services/wizards/resource-list.js";
import type { runLayerEditWizard as RunLayerEditWizard } from "../../src/services/wizards/layer-edit.js";
import type { runInteractiveCatalogSearch as RunInteractiveCatalogSearch } from "../../src/services/wizards/interactive-catalog-search.js";
import type { runInteractiveCatalogBrowser as RunInteractiveCatalogBrowser } from "../../src/services/wizards/interactive-catalog-browser.js";
import type { runInteractiveLayerListBrowse as RunInteractiveLayerListBrowse } from "../../src/services/wizards/interactive-layer-list-browse.js";

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
  ...args: Parameters<typeof import("../../src/services/wizards/searchable-multi-select.js").promptForSearchableMultiSelect>
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

function normalizeDeleteWizardSelection(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  throw new Error(
    "Delete wizard responses must resolve to a string id or array of ids in runCli test harness",
  );
}

const environmentDeleteWizardMock = mock(async (
  ...args: Parameters<typeof RunEnvironmentDeleteWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/environment-delete.ts?actual"
    );
    return actualWizard.runEnvironmentDeleteWizard(...args);
  }
  return normalizeDeleteWizardSelection(shiftSinglePromptValue());
});

const environmentShowWizardMock = mock(async (
  ...args: Parameters<typeof RunEnvironmentShowWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/environment-show.ts?actual"
    );
    return actualWizard.runEnvironmentShowWizard(...args);
  }
  const value = shiftSinglePromptValue();
  if (typeof value !== "string") {
    throw new Error(
      "Environment show wizard responses must resolve to a string in runCli test harness",
    );
  }
  return value.length > 0 ? value : undefined;
});

const resourceDeleteWizardMock = mock(async (
  ...args: Parameters<typeof RunResourceDeleteWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/resource-delete.ts?actual"
    );
    return actualWizard.runResourceDeleteWizard(...args);
  }
  return normalizeDeleteWizardSelection(shiftSinglePromptValue());
});

const layerDeleteWizardMock = mock(async (
  ...args: Parameters<typeof RunLayerDeleteWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/layer-delete.ts?actual"
    );
    return actualWizard.runLayerDeleteWizard(...args);
  }
  return normalizeDeleteWizardSelection(shiftSinglePromptValue());
});

const layerShowWizardMock = mock(async (
  ...args: Parameters<typeof RunLayerShowWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/layer-show.ts?actual"
    );
    return actualWizard.runLayerShowWizard(...args);
  }
  const value = shiftSinglePromptValue();
  if (typeof value !== "string") {
    throw new Error(
      "Layer show wizard responses must resolve to a string in runCli test harness",
    );
  }
  return value.length > 0 ? value : undefined;
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

mock.module("../../src/services/wizards/environment-delete.js", () => ({
  runEnvironmentDeleteWizard: environmentDeleteWizardMock,
}));

mock.module("../../src/services/wizards/environment-show.js", () => ({
  runEnvironmentShowWizard: environmentShowWizardMock,
}));

mock.module("../../src/services/wizards/resource-delete.js", () => ({
  runResourceDeleteWizard: resourceDeleteWizardMock,
}));

mock.module("../../src/services/wizards/layer-delete.js", () => ({
  runLayerDeleteWizard: layerDeleteWizardMock,
}));

mock.module("../../src/services/wizards/layer-show.js", () => ({
  runLayerShowWizard: layerShowWizardMock,
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

const layerEditWizardMock = mock(async (
  ...args: Parameters<typeof RunLayerEditWizard>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/layer-edit.ts?actual"
    );
    return actualWizard.runLayerEditWizard(...args);
  }
  const value = shiftSinglePromptValue();
  if (!Array.isArray(value)) {
    throw new Error(
      "Layer edit wizard responses must resolve to an array of rows in runCli test harness",
    );
  }
  return value;
});

mock.module("../../src/services/wizards/layer-edit.js", () => ({
  runLayerEditWizard: layerEditWizardMock,
}));

function resolveInteractiveLayerInstallSelection(value: unknown) {
  if (typeof value === "string") {
    const parts = value.split("/").filter(Boolean);
    if (parts.length === 2) {
      const [orgSlug, slug] = parts;
      return {
        orgSlug,
        catalogSlug: "default",
        slug,
        version: "1.0.0",
        selector: value,
      };
    }
    if (parts.length === 3) {
      const [orgSlug, catalogSlug, slug] = parts;
      return {
        orgSlug,
        catalogSlug,
        slug,
        version: "1.0.0",
        selector: value,
      };
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.orgSlug === "string" && typeof record.slug === "string") {
      const catalogSlug = typeof record.catalogSlug === "string" ? record.catalogSlug : "default";
      const selector = typeof record.selector === "string"
        ? record.selector
        : catalogSlug === "default"
          ? `${record.orgSlug}/${record.slug}`
          : `${record.orgSlug}/${catalogSlug}/${record.slug}`;
      return {
        orgSlug: record.orgSlug,
        catalogSlug,
        slug: record.slug,
        version: typeof record.version === "string" ? record.version : "1.0.0",
        selector,
      };
    }
  }
  throw new Error(
    "Interactive layer install responses must resolve to org/library string or selection object",
  );
}

const interactiveCatalogBrowserMock = mock(async (
  ...args: Parameters<typeof RunInteractiveCatalogBrowser>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/interactive-catalog-browser.ts?actual"
    );
    return actualWizard.runInteractiveCatalogBrowser(...args);
  }
  return resolveInteractiveLayerInstallSelection(shiftSinglePromptValue());
});

mock.module("../../src/services/wizards/interactive-catalog-browser.js", () => ({
  runInteractiveCatalogBrowser: interactiveCatalogBrowserMock,
}));

const interactiveLayerListBrowseMock = mock(async (
  ...args: Parameters<typeof RunInteractiveLayerListBrowse>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/interactive-layer-list-browse.ts?actual"
    );
    return actualWizard.runInteractiveLayerListBrowse(...args);
  }
  return resolveInteractiveLayerInstallSelection(shiftSinglePromptValue());
});

mock.module("../../src/services/wizards/interactive-layer-list-browse.js", () => ({
  runInteractiveLayerListBrowse: interactiveLayerListBrowseMock,
}));

const interactiveCatalogSearchMock = mock(async (
  ...args: Parameters<typeof RunInteractiveCatalogSearch>
) => {
  if (!runCliHarnessActive) {
    const actualWizard = await import(
      "../../src/services/wizards/interactive-catalog-search.ts?actual"
    );
    return actualWizard.runInteractiveCatalogSearch(...args);
  }
  const value = shiftSinglePromptValue();
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : null;
  if (!entries) {
    throw new Error(
      "Interactive catalog search responses must resolve to an array of selectors",
    );
  }
  return {
    selections: entries.map((entry) => {
        if (typeof entry === "string") {
          const parts = entry.split("/").filter(Boolean);
          if (parts.length === 3) {
            const [orgSlug, catalogSlug, slug] = parts;
            return {
              orgSlug,
              catalogSlug,
              slug,
              version: "1.0.0",
              selector: entry,
            };
          }
        }
        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          if (typeof record.orgSlug === "string" && typeof record.slug === "string") {
            const catalogSlug = typeof record.catalogSlug === "string"
              ? record.catalogSlug
              : "default";
            const selector = typeof record.selector === "string"
              ? record.selector
              : `${record.orgSlug}/${catalogSlug}/${record.slug}`;
            return {
              orgSlug: record.orgSlug,
              catalogSlug,
              slug: record.slug,
              version: typeof record.version === "string" ? record.version : "1.0.0",
              selector,
            };
          }
        }
        throw new Error("Invalid interactive catalog search selection entry");
      }),
  };
});

mock.module("../../src/services/wizards/interactive-catalog-search.js", () => ({
  runInteractiveCatalogSearch: interactiveCatalogSearchMock,
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
    HARNESSDECK_FORCE_WIZARD: effectiveIsTTY ? "1" : undefined,
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
