import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI init", () => {
  it("initializes the database and seeds built-in templates", async () => {
    const context = await createTestContext("cli-init");

    try {
      const result = await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");

      expect(result.stdout).toContain("Database initialized");
      expect(existsSync(context.connection.getDbPath())).toBe(true);
      expect(presetModel.listPresets({ templates_only: true }).length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });
});
