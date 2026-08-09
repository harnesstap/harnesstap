import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI marketplace", () => {
  it("adds and lists a marketplace", async () => {
    const context = await createTestContext("cli-mkt-add-list");
    try {
      await runCli(["init"]);
      const add = await runCli(
        [
          "marketplace",
          "add",
          "https://github.com/example/demo.git",
          "--name",
          "demo",
          "--platform",
          "claude-code",
          "--format",
          "json",
        ],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const payload = JSON.parse(list.stdout);
      expect(payload.marketplaces[0].name).toBe("demo");
    } finally {
      await context.cleanup();
    }
  });

  it("removes a configured marketplace", async () => {
    const context = await createTestContext("cli-mkt-remove");
    try {
      await runCli(["init"]);
      await runCli(
        [
          "marketplace",
          "add",
          "https://github.com/example/demo.git",
          "--name",
          "demo",
          "--platform",
          "claude-code",
          "--format",
          "json",
        ],
        { isTTY: false },
      );

      const remove = await runCli(
        ["marketplace", "remove", "demo", "--format", "json"],
        { isTTY: false },
      );
      expect(remove.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(remove.stdout);
      expect(payload.status).toBe("removed");
      expect(payload.entry.name).toBe("demo");

      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const listed = JSON.parse(list.stdout);
      expect(listed.marketplaces).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("fails remove when marketplace is missing", async () => {
    const context = await createTestContext("cli-mkt-remove-missing");
    try {
      await runCli(["init"]);
      await expect(
        runCli(["marketplace", "remove", "missing"], { isTTY: false }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await context.cleanup();
    }
  });
});
