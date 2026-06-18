import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("layer edit --add errors", () => {
  it("suggests --type when the selector omits a type prefix", async () => {
    const context = await createTestContext("cli-combine-type-hint");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "team-stack"]);

      const result = await runCli(["layer", "edit", "team-stack", "--add", "auth-helper", "--no-interactive"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Attachment type required");
      expect(result.stderr).toContain("--type skill");
      expect(result.stderr).toContain("team-stack --add auth-helper --type skill");
    } finally {
      await context.cleanup();
    }
  });
});
