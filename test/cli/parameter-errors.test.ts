import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("parameter errors", () => {
  it("plugin show without name reports missing required argument", async () => {
    const context = await createTestContext("cli-parameter-errors-plugin-show");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "team-stack"]);

      const r = await runCli(["plugin", "show"], { isTTY: false });

      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("missing required argument 'name'");
      expect(r.stderr).toContain("USAGE");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin edit conflicting environment flags", async () => {
    const r = await runCli(["plugin", "edit", "x", "--environment", "dev", "--clear-environment"]);
    expect(r.stderr).toMatch(/cannot use.*together/i);
  });

  it("scan -h shows help", async () => {
    const r = await runCli(["scan", "-h"]);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("USAGE");
  });

  it("plugin delete without name reports missing required argument", async () => {
    const context = await createTestContext("cli-parameter-errors-plugin-delete");
    try {
      await runCli(["init"]);

      const r = await runCli(["plugin", "delete"], { isTTY: false });

      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("missing required argument 'name'");
      expect(r.stderr).toContain("USAGE");
    } finally {
      await context.cleanup();
    }
  });

  it("resource delete without name reports missing required argument", async () => {
    const context = await createTestContext("cli-parameter-errors-resource-delete");
    try {
      await runCli(["init"]);

      const r = await runCli(["resource", "delete"], { isTTY: false });

      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("missing required argument 'resource'");
      expect(r.stderr).toContain("USAGE");
    } finally {
      await context.cleanup();
    }
  });
});
