import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("impeccable-layout integration", () => {
  it("persistMergedProjectScan does not throw on repo root", async () => {
    const context = await createInitializedTestContext("impeccable-layout-scan");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const merged = await scanner.persistMergedProjectScan(fixture, undefined, {
        originRef: fixture,
      });
      expect(
        merged.resources.some((r) => r.type === "skill" && r.name === "impeccable"),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
