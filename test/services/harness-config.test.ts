import { describe, expect, it } from "bun:test";

describe("harness config service", () => {
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
