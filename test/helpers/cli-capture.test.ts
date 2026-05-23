import { describe, expect, it } from "vitest";
import { createTestContext } from "./db.ts";
import { assertCliOutputCaptured } from "./cli.ts";

describe("CLI output capture validation", () => {
  it("captures UI renderer output written through console.log", async () => {
    const context = await createTestContext("cli-capture");
    try {
      const result = await assertCliOutputCaptured(["-h"]);
      expect(result.stdout.length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });
});
