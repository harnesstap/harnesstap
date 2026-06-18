import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import {
  clearActiveProfileName,
  getActiveProfileName,
  setActiveProfileName,
} from "../../src/services/active-profile.ts";

describe("active-profile service", () => {
  it("reads, writes, and clears active profile state", async () => {
    const context = await createTestContext("active-profile");
    try {
      expect(getActiveProfileName()).toBeUndefined();

      setActiveProfileName("default");
      expect(getActiveProfileName()).toBe("default");
      expect(
        existsSync(join(context.homeDir, ".harnessdeck", "active-profile.json")),
      ).toBe(true);

      clearActiveProfileName();
      expect(getActiveProfileName()).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
