import { describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../src/utils/is-main-module.ts";

describe("isMainModule", () => {
  it("treats a realpath-equal argv[1] as the main module, including npm-style symlinks", () => {
    const dir = join(tmpdir(), `ht-is-main-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "bin.js");
    const link = join(dir, "ht");
    writeFileSync(target, "console.log('ok');\n");
    symlinkSync(target, link);

    const metaUrl = pathToFileURL(realpathSync(target)).href;
    expect(isMainModule(metaUrl, link)).toBe(true);
    expect(isMainModule(metaUrl, target)).toBe(true);
    expect(isMainModule(metaUrl, join(dir, "other.js"))).toBe(false);
    expect(isMainModule(metaUrl, undefined)).toBe(false);
  });
});
