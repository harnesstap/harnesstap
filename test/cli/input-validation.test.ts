import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { listPlugins } from "../../src/models/plugin-model.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI input validation", () => {
  it("rejects non-interactive profile use without a name and writes nothing", async () => {
    const context = await createTestContext("cli-profile-use-no-name");
    try {
      await runCli(["init", "--no-interactive"]);
      const before = await runCli(["profile", "list", "--format", "json"]);
      const result = await runCli(["profile", "use", "--no-interactive"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Pass a profile name.");
      expect(result.stderr).toContain('ht profile use "global default"');
      const after = await runCli(["profile", "list", "--format", "json"]);
      expect(after.stdout).toBe(before.stdout);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects empty and path-like plugin names", async () => {
    const context = await createTestContext("cli-plugin-create-name");
    try {
      await runCli(["init", "--no-interactive"]);
      const empty = await runCli(["plugin", "create", "   "]);
      expect(empty.exitCode).toBe(1);
      expect(empty.stderr).toContain("Pass a plugin name.");

      const evil = await runCli(["plugin", "create", "../evil"]);
      expect(evil.exitCode).toBe(1);
      expect(evil.stderr).toContain("isn't a valid plugin name");
      expect(listPlugins().some((plugin) => plugin.name.includes("evil"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("expands ~ on --project and fails missing dirs", async () => {
    const context = await createTestContext("cli-user-path-project");
    try {
      await runCli(["init", "--no-interactive"]);
      const nested = join(context.homeDir, "projects", "demo");
      mkdirSync(nested, { recursive: true });
      const previousHome = process.env.HOME;
      process.env.HOME = context.homeDir;
      try {
        const ok = await runCli(["targets", "--project", "~/projects/demo", "--format", "json"]);
        expect(ok.exitCode ?? 0).toBe(0);
        expect(JSON.parse(ok.stdout)).toEqual(expect.objectContaining({ source: expect.any(String) }));

        const missing = await runCli(["status", "~/no-such-project"]);
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain("Directory not found");
      } finally {
        process.env.HOME = previousHome;
      }
    } finally {
      await context.cleanup();
    }
  });
});
