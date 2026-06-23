import { ExitPromptError } from "@inquirer/core";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { isPromptCancellationError } from "../../src/services/wizards/shared.ts";

describe("prompt cancellation", () => {
  it("detects inquirer prompt cancellation errors", () => {
    expect(
      isPromptCancellationError(
        new ExitPromptError("User force closed the prompt with SIGINT"),
      ),
    ).toBe(true);
    expect(isPromptCancellationError(new Error("something else"))).toBe(false);
  });

  it("resource delete exits quietly when the wizard is interrupted", async () => {
    const context = await createTestContext("cli-resource-delete-sigint");
    try {
      await runCli(["init"]);
      const result = await runCli(["resource", "delete"], {
        isTTY: true,
        promptResponses: [{ __promptCancel: true }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toMatch(/force closed|SIGINT/i);
    } finally {
      await context.cleanup();
    }
  });

  it("layer list exits quietly when the browser is cancelled", async () => {
    const context = await createTestContext("cli-layer-list-esc");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "list"], {
        isTTY: true,
        promptResponses: [{ __promptCancel: true }],
      });

      expect(result.exitCode ?? 0).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toMatch(/ExitPromptError|Layer list cancelled/i);
    } finally {
      await context.cleanup();
    }
  });
});
