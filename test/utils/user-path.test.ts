import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { expandUserPath, resolveUserPath, UserPathError } from "../../src/utils/user-path.ts";
import { createTestContext } from "../helpers/db.ts";

describe("resolveUserPath", () => {
  it("expands a leading ~ to HOME", async () => {
    const context = await createTestContext("user-path-tilde");
    try {
      const nested = join(context.homeDir, "projects", "demo");
      mkdirSync(nested, { recursive: true });
      const previousHome = process.env.HOME;
      process.env.HOME = context.homeDir;
      try {
        expect(expandUserPath("~/projects/demo")).toBe(nested);
        expect(resolveUserPath("~/projects/demo", { mustExist: true })).toBe(nested);
      } finally {
        process.env.HOME = previousHome;
      }
    } finally {
      await context.cleanup();
    }
  });

  it("throws when mustExist and the path is missing", () => {
    expect(() => resolveUserPath("/definitely-missing-harnesstap-path", { mustExist: true })).toThrow(
      UserPathError,
    );
  });
});
