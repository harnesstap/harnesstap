import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

describe("removed layer transport commands", () => {
  it("layer export prints migration guidance", async () => {
    const ctx = await createTestContext("removed-export");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "export", "x"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("layer export was removed");
      expect(result.stderr).toContain("migrate export");
    } finally {
      await ctx.cleanup();
    }
  });

  it("layer import prints migration guidance", async () => {
    const ctx = await createTestContext("removed-import");
    try {
      await runCli(["init"]);
      const result = await runCli(["layer", "import", "./missing.harnessdeck.toml"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("layer import was removed");
      expect(result.stderr).toContain("migrate import");
    } finally {
      await ctx.cleanup();
    }
  });
});
