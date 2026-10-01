import { beforeEach, describe, expect, it, mock } from "bun:test";

const promptMock = mock(() => Promise.resolve({}));
const searchPromptMock = mock(() => Promise.resolve("cursor"));
const multiSelectMock = mock(() => Promise.resolve([]));

mock.module("inquirer", () => ({
  default: {
    prompt: promptMock,
  },
}));

mock.module("@inquirer/search", () => ({
  default: searchPromptMock,
}));

mock.module("../../src/services/wizards/searchable-multi-select.js", () => ({
  promptForSearchableMultiSelect: multiSelectMock,
}));

describe("harness config service", () => {
  beforeEach(() => {
    promptMock.mockReset();
    searchPromptMock.mockReset();
    multiSelectMock.mockReset();
  });

  it("prompts a single multi-select with current registered harnesses", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    multiSelectMock.mockResolvedValueOnce(["cursor", "codex"]);

    try {
      const service = await import("../../src/services/harness-config.ts");
      const selection = await service.resolveHarnessSelection({
        current: {
          registered_harnesses: ["claude-code", "codex", "cursor"],
          updated_at: new Date().toISOString(),
        },
      });

      expect(selection).toEqual({
        registered_harnesses: ["cursor", "codex"],
      });

      expect(searchPromptMock).not.toHaveBeenCalled();
      expect(multiSelectMock).toHaveBeenCalledTimes(1);

      const prompt = multiSelectMock.mock.calls[0]?.[0] as {
        default?: string[];
        message?: string;
        choices?: Array<{ value: string }>;
      };
      expect(prompt?.default).toEqual(["claude-code", "codex", "cursor"]);
      expect(prompt?.message).toContain("Current harnesses: claude-code, codex, cursor");
      expect(
        (prompt?.choices as Array<{ value: string }>).map((choice) => choice.value),
      ).toContain("cursor");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("uses explicit main and aliases in non-interactive mode", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      main: "claude-code",
      aliases: ["cursor", "copilot-cli"],
      nonInteractive: true,
    });

    expect(selection).toEqual({
      registered_harnesses: ["claude-code", "cursor", "copilot-cli"],
    });
  });

  it("uses --harnesses in non-interactive mode", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      harnesses: ["cursor", "codex", "cursor"],
      nonInteractive: true,
    });

    expect(selection).toEqual({
      registered_harnesses: ["cursor", "codex"],
    });
  });

  it("drops duplicates from deprecated main/aliases in non-interactive mode", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      main: "cursor",
      aliases: ["cursor", "codex", "cursor"],
      nonInteractive: true,
    });

    expect(selection).toEqual({
      registered_harnesses: ["cursor", "codex"],
    });
  });

  it("defaults from current preference", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      current: {
        registered_harnesses: ["claude-code", "cursor"],
        updated_at: new Date().toISOString(),
      },
      nonInteractive: true,
    });

    expect(selection.registered_harnesses).toEqual(["claude-code", "cursor"]);
  });

  it("defaults from detected platforms", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      detected: ["cursor", "codex"],
      nonInteractive: true,
    });

    expect(selection.registered_harnesses).toEqual(["cursor", "codex"]);
  });

  it("skips prompts when only one harness is detected", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      const service = await import("../../src/services/harness-config.ts");
      const selection = await service.resolveHarnessSelection({
        detected: ["claude-code"],
      });

      expect(selection).toEqual({
        registered_harnesses: ["claude-code"],
      });
      expect(promptMock).not.toHaveBeenCalled();
      expect(multiSelectMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("defaults to first registered platform when nothing else available", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      nonInteractive: true,
    });

    expect(selection.registered_harnesses).toEqual(["claude-code"]);
  });

  it("throws on unsupported harness", async () => {
    const service = await import("../../src/services/harness-config.ts");

    await expect(
      service.resolveHarnessSelection({
        main: "nonexistent-harness",
        nonInteractive: true,
      }),
    ).rejects.toThrow("Unsupported harness: nonexistent-harness");
  });

  it("uses custom messages in interactive mode", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    multiSelectMock.mockResolvedValueOnce(["cursor"]);

    try {
      const service = await import("../../src/services/harness-config.ts");
      await service.resolveHarnessSelection({
        mainMessage: "Pick your main",
        nonInteractive: false,
      });

      const question = multiSelectMock.mock.calls[0]?.[0] as {
        message?: string;
      };
      expect(question?.message).toContain("Pick your main");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("deduplicates aliases-only input", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      aliases: ["codex", "cursor", "codex", "copilot-cli", "cursor"],
      nonInteractive: true,
    });

    expect(selection.registered_harnesses).toEqual([
      "codex",
      "cursor",
      "copilot-cli",
    ]);
  });

  it("returns a single-item set when only main is provided", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      main: "claude-code",
      nonInteractive: true,
    });

    expect(selection.registered_harnesses).toEqual(["claude-code"]);
  });

  it("uses the wizard when required args are missing on an interactive TTY", async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalCi = process.env.CI;
    const originalNoInteractive = process.env.HARNESSTAP_NO_INTERACTIVE;

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.CI;
    delete process.env.HARNESSTAP_NO_INTERACTIVE;

    try {
      const shared = await import("../../src/services/wizards/shared.ts");
      expect(shared.shouldUseWizard({ missingRequiredArgs: true })).toBe(true);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalStdinIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
      if (originalNoInteractive === undefined) {
        delete process.env.HARNESSTAP_NO_INTERACTIVE;
      } else {
        process.env.HARNESSTAP_NO_INTERACTIVE = originalNoInteractive;
      }
    }
  });

  it("suppresses the wizard for json, CI, and no-interactive flows", async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalCi = process.env.CI;
    const originalNoInteractive = process.env.HARNESSTAP_NO_INTERACTIVE;

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      const shared = await import("../../src/services/wizards/shared.ts");

      expect(shared.shouldUseWizard({ missingRequiredArgs: true, format: "json" })).toBe(false);
      expect(shared.shouldUseWizard({ missingRequiredArgs: true, noInteractive: true })).toBe(false);

      process.env.CI = "true";
      expect(shared.shouldUseWizard({ missingRequiredArgs: true })).toBe(false);

      process.env.CI = "1";
      expect(shared.shouldUseWizard({ missingRequiredArgs: true })).toBe(false);

      delete process.env.CI;
      process.env.HARNESSTAP_NO_INTERACTIVE = "1";
      expect(shared.shouldUseWizard({ missingRequiredArgs: true })).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalStdinIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
      if (originalNoInteractive === undefined) {
        delete process.env.HARNESSTAP_NO_INTERACTIVE;
      } else {
        process.env.HARNESSTAP_NO_INTERACTIVE = originalNoInteractive;
      }
    }
  });
});
