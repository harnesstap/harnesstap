import { describe, expect, it } from "bun:test";
import { createLayer } from "../../src/models/layer-model.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("CLI __complete", () => {
  it("returns matching local layers for layer show completion", async () => {
    const context = await createInitializedTestContext("cli-complete-layer");
    try {
      createLayer({ name: "engineering-foundation", version: "1.2.0" });
      createLayer({ name: "demo-layer", version: "0.1.0" });

      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "layer",
        "show",
        "eng",
      ]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("engineering-foundation");
      expect(result.stdout).toContain("engineering-foundation@1.2.0");
      expect(result.stdout).not.toContain("demo-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("returns harness slugs for init --main without local database", async () => {
    const context = await createTestContextWithoutHarnessdeck();
    try {
      const result = await runCli([
        "__complete",
        "zsh",
        "--",
        "hd",
        "init",
        "--main",
        "cur",
      ]);

      expect(result.stdout).toContain("cursor");
      expect(result.stdout).not.toContain("engineering-foundation");
    } finally {
      await context.cleanup();
    }
  });
});

async function createTestContextWithoutHarnessdeck(): Promise<{
  cleanup: () => Promise<void>;
}> {
  const { createTestContext } = await import("../helpers/db.ts");
  const context = await createTestContext("cli-complete-no-home");
  return context;
}
