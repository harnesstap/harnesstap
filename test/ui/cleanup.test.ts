import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

describe("Task 8 cleanup: no chalk/log leakage outside src/ui/", () => {
  const indexSrc = readFileSync(resolve(root, "src/index.ts"), "utf-8");

  it("src/index.ts does not import chalk", () => {
    expect(indexSrc).not.toMatch(/^import\s+.*\bchalk\b/m);
  });

  it("src/index.ts does not import from utils/logger", () => {
    expect(indexSrc).not.toMatch(/from\s+["'].*utils\/logger/);
  });

  it("src/index.ts has no remaining log.* calls", () => {
    // Only flag `log.` as a method call (not e.g. 'changelog' or 'log message')
    expect(indexSrc).not.toMatch(/\blog\.(warn|error|info|dim|success|table)\s*\(/);
  });

  it("src/index.ts has no direct chalk.* usage", () => {
    expect(indexSrc).not.toMatch(/\bchalk\b/);
  });

  it("src/utils/logger.ts no longer exists", () => {
    expect(existsSync(resolve(root, "src/utils/logger.ts"))).toBe(false);
  });

  it("disableColor is exported from ui/index", () => {
    const uiIndex = readFileSync(resolve(root, "src/ui/index.ts"), "utf-8");
    expect(uiIndex).toContain("disableColor");
  });
});
