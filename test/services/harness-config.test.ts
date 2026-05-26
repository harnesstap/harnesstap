import { beforeEach, describe, expect, it, mock } from "bun:test";

const promptMock = mock(() => Promise.resolve({}));

mock.module("inquirer", () => ({
  default: {
    prompt: promptMock,
  },
}));

describe("harness config service", () => {
  beforeEach(() => {
    promptMock.mockReset();
  });

  it("excludes the chosen main harness from alias choices", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    promptMock
      .mockResolvedValueOnce({ main_harness: "cursor" })
      .mockResolvedValueOnce({ alias_harnesses: ["codex"] });

    try {
      const service = await import("../../src/services/harness-config.ts");
      const selection = await service.resolveHarnessSelection({
        current: {
          main_harness: "claude-code",
          alias_harnesses: ["codex", "cursor"],
          updated_at: new Date().toISOString(),
        },
      });

      expect(selection).toEqual({
        main_harness: "cursor",
        alias_harnesses: ["codex"],
      });

      expect(promptMock).toHaveBeenCalledTimes(2);

      const aliasQuestion = promptMock.mock.calls[1]?.[0]?.[0];
      expect(aliasQuestion?.default).toEqual(["codex"]);
      expect(
        (aliasQuestion?.choices as Array<{ value: string }>).map(
          (choice) => choice.value,
        ),
      ).not.toContain("cursor");
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
      main_harness: "claude-code",
      alias_harnesses: ["cursor", "copilot-cli"],
    });
  });

  it("excludes main from aliases in non-interactive mode", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      main: "cursor",
      aliases: ["cursor", "codex", "cursor"],
      nonInteractive: true,
    });

    expect(selection).toEqual({
      main_harness: "cursor",
      alias_harnesses: ["codex"],
    });
  });

  it("defaults main from current preference", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      current: {
        main_harness: "claude-code",
        alias_harnesses: ["cursor"],
        updated_at: new Date().toISOString(),
      },
      nonInteractive: true,
    });

    expect(selection.main_harness).toBe("claude-code");
  });

  it("defaults main from detected platforms", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      detected: ["cursor", "codex"],
      nonInteractive: true,
    });

    expect(selection.main_harness).toBe("cursor");
  });

  it("defaults main to first registered platform when nothing else available", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      nonInteractive: true,
    });

    // First registered platform should be claude-code
    expect(selection.main_harness).toBe("claude-code");
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

    promptMock
      .mockResolvedValueOnce({ main_harness: "cursor" })
      .mockResolvedValueOnce({ alias_harnesses: [] });

    try {
      const service = await import("../../src/services/harness-config.ts");
      await service.resolveHarnessSelection({
        mainMessage: "Pick your main",
        nonInteractive: false,
      });

      const mainQuestion = promptMock.mock.calls[0]?.[0]?.[0];
      expect(mainQuestion?.message).toBe("Pick your main");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("deduplicates alias_harnesses", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      aliases: ["codex", "cursor", "codex", "copilot-cli", "cursor"],
      nonInteractive: true,
    });

    expect(selection.alias_harnesses).toEqual(["codex", "cursor", "copilot-cli"]);
  });

  it("returns empty aliases when none provided and no detected", async () => {
    const service = await import("../../src/services/harness-config.ts");
    const selection = await service.resolveHarnessSelection({
      main: "claude-code",
      nonInteractive: true,
    });

    expect(selection.alias_harnesses).toEqual([]);
  });

  it("uses the wizard when required args are missing on an interactive TTY", async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalCi = process.env.CI;
    const originalNoInteractive = process.env.HARNESSDECK_NO_INTERACTIVE;

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.CI;
    delete process.env.HARNESSDECK_NO_INTERACTIVE;

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
        delete process.env.HARNESSDECK_NO_INTERACTIVE;
      } else {
        process.env.HARNESSDECK_NO_INTERACTIVE = originalNoInteractive;
      }
    }
  });

  it("suppresses the wizard for json, CI, and no-interactive flows", async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalCi = process.env.CI;
    const originalNoInteractive = process.env.HARNESSDECK_NO_INTERACTIVE;

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
      process.env.HARNESSDECK_NO_INTERACTIVE = "1";
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
        delete process.env.HARNESSDECK_NO_INTERACTIVE;
      } else {
        process.env.HARNESSDECK_NO_INTERACTIVE = originalNoInteractive;
      }
    }
  });
});
