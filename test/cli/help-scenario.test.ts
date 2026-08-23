import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("help scenario commands", () => {
  it("does not double-prefix typical commands", async () => {
    const context = await createTestContext("help-scenario-prefix");
    try {
      const result = await runCli(["help", "scenario", "1"]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).not.toContain("harnesstap harnesstap");
      expect(result.stdout).not.toMatch(/\bht ht\b/);
      expect(result.stdout).toMatch(/\b(ht|harnesstap) init\b/);
    } finally {
      await context.cleanup();
    }
  });

  it("rewrites markdown ht lines to the invocation name once", async () => {
    const context = await createTestContext("help-scenario-40");
    try {
      const result = await runCli(["help", "scenario", "40"]);
      expect(result.stdout).not.toContain("harnesstap ht ");
      expect(result.stdout).toMatch(/\b(ht|harnesstap) use --list\b/);
    } finally {
      await context.cleanup();
    }
  });
});
