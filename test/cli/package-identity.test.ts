import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("package identity", () => {
  it("publishes harnesstap and ht bins", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "../../package.json"), "utf-8"),
    ) as { name: string; bin: Record<string, string> };
    expect(pkg.name).toBe("harnesstap");
    expect(pkg.bin).toEqual({
      harnesstap: "./dist/index.js",
      ht: "./dist/index.js",
    });
  });
});
