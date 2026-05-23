import { describe, expect, it } from "vitest";
import { assertCliOutputCaptured } from "./cli.ts";

describe("CLI output capture validation", () => {
  it("captures UI renderer output written through console.log", async () => {
    const result = await assertCliOutputCaptured(["-h"]);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
