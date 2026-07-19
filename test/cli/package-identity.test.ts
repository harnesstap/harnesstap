import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("package identity", () => {
  it("publishes harnesstap and ht bins", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "../../package.json"), "utf-8"),
    ) as { name: string; bin: Record<string, string> };
    expect(pkg.name).toBe("harnesstap");
    expect(pkg.bin.harnesstap).toBe("./dist/index.js");
    expect(pkg.bin.ht).toBe("./dist/index.js");
    expect(pkg.bin.harnessdeck).toBeUndefined();
    expect(pkg.bin.hd).toBeUndefined();
  });
});
