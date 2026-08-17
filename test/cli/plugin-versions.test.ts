import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("CLI plugin versions", () => {
  it("lists local versions newest first", async () => {
    const context = await createTestContext("cli-plugin-versions");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["plugin", "cut", "alpha", "--version", "1.1.0"]);

      const human = await runCli(["plugin", "versions", "alpha"]);
      expect(human.exitCode ?? 0).toBe(0);
      expect(human.stdout).toContain("1.1.0");
      expect(human.stdout).toContain("Working head");
      expect(human.stdout).toContain("1.0.0");

      const json = await runCli(["plugin", "versions", "alpha", "--format", "json"]);
      const payload = JSON.parse(json.stdout) as {
        versions: Array<{ version: string; is_head: boolean; frozen_at: string | null }>;
      };
      expect(payload.versions[0]).toMatchObject({
        version: "1.1.0",
        is_head: true,
        frozen_at: null,
      });
      expect(payload.versions[1]?.version).toBe("1.0.0");
      expect(payload.versions[1]?.is_head).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when the plugin is missing", async () => {
    const context = await createTestContext("cli-plugin-versions-missing");
    try {
      await runCli(["init"]);
      const result = await runCli(["plugin", "versions", "missing"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Plugin not found: missing");
    } finally {
      await context.cleanup();
    }
  });
});
