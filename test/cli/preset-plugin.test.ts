import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI preset plugin pins", () => {
  it("adds and shows plugin pin on preset", async () => {
    const context = await createTestContext("cli-preset-plugin");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "p1"]);
      await runCli([
        "preset",
        "add-plugin",
        "p1",
        "fmt@acme",
        "--version",
        ">=2.0.0 <3.0.0",
      ]);
      const show = await runCli(["preset", "show", "p1"]);
      expect(show.stdout).toContain("fmt@acme");
      expect(show.stdout).toContain(">=2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("includes plugins in preset show JSON", async () => {
    const context = await createTestContext("cli-preset-plugin-json");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "pj"]);
      await runCli([
        "preset",
        "add-plugin",
        "pj",
        "tools@hub",
        "--version",
        "^1.2.3",
      ]);
      const show = await runCli([
        "preset",
        "show",
        "pj",
        "--format",
        "json",
      ]);
      const data = JSON.parse(show.stdout.trim()) as {
        plugins: Array<{ ref: string; version_constraint: string }>;
      };
      expect(data.plugins).toHaveLength(1);
      expect(data.plugins[0]?.ref).toBe("tools@hub");
      expect(data.plugins[0]?.version_constraint).toBe("^1.2.3");
    } finally {
      await context.cleanup();
    }
  });

  it("remove-plugin drops pin from show", async () => {
    const context = await createTestContext("cli-preset-plugin-remove");

    try {
      await runCli(["init"]);
      await runCli(["preset", "create", "pr"]);
      await runCli([
        "preset",
        "add-plugin",
        "pr",
        "gone@mp",
        "--version",
        "1.0.0",
      ]);
      await runCli(["preset", "remove-plugin", "pr", "gone@mp"]);
      const show = await runCli(["preset", "show", "pr"]);
      expect(show.stdout).not.toContain("gone@mp");
    } finally {
      await context.cleanup();
    }
  });
});
