import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("global apply without registered harnesses", () => {
  it("refuses to target default harnesses", async () => {
    const context = await createTestContext("apply-no-harnesses");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "apply",
        "global default",
        "--global",
        "--dry-run",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error: Not set up for any harness yet.");
      expect(result.stderr).toContain("Run ht harness set");
    } finally {
      await context.cleanup();
    }
  });
});
