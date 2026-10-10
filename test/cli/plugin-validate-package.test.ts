import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const fixturesDir = join(import.meta.dirname, "../../schemas/fixtures");

describe("ht plugin validate-package", () => {
  it("is hidden from plugin help", async () => {
    const context = await createTestContext("cli-validate-package-help");
    try {
      const help = await runCli(["plugin", "--help"]);
      expect(help.stdout).not.toContain("validate-package");
    } finally {
      await context.cleanup();
    }
  });

  it("accepts the golden fixture without $schema", async () => {
    const context = await createTestContext("cli-validate-package-ok");
    try {
      const result = await runCli([
        "plugin",
        "validate-package",
        join(fixturesDir, "catalog-missing-schema.ap.json"),
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBeUndefined();
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          ok: true,
          name: "engineering-foundation",
          schemaDefaulted: true,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects a package without $schema when --strict (publish rules)", async () => {
    const context = await createTestContext("cli-validate-package-strict");
    try {
      const result = await runCli([
        "plugin",
        "validate-package",
        join(fixturesDir, "catalog-missing-schema.ap.json"),
        "--strict",
        "--format",
        "json",
      ]);
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as { ok: boolean; error: string };
      expect(payload.ok).toBe(false);
      expect(payload.error).toMatch(/\$schema/);
    } finally {
      await context.cleanup();
    }
  });
});
