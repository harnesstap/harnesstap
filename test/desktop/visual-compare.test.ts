import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareShot,
  decodePng,
  DEFAULT_MAX_RATIO,
  mismatchRatio,
  solidPng,
} from "../../apps/desktop/scripts/visual-compare.mjs";

describe("mismatchRatio", () => {
  test("is 0 for identical images", () => {
    const buffer = solidPng(4, 4, [10, 20, 30, 255]);
    const a = decodePng(buffer);
    const b = decodePng(buffer);
    expect(mismatchRatio(a, b)).toBe(0);
  });

  test("is 1 when dimensions differ", () => {
    const a = decodePng(solidPng(2, 2, [0, 0, 0, 255]));
    const b = decodePng(solidPng(3, 2, [0, 0, 0, 255]));
    expect(mismatchRatio(a, b)).toBe(1);
  });
});

describe("compareShot", () => {
  test("passes when the ratio is under 0.2%", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ht-visual-"));
    const actual = path.join(dir, "actual.png");
    const baseline = path.join(dir, "baseline.png");
    const buffer = solidPng(10, 10, [40, 40, 40, 255]);
    writeFileSync(actual, buffer);
    writeFileSync(baseline, buffer);
    const result = compareShot(actual, baseline);
    expect(result.ok).toBe(true);
    expect(result.ratio).toBeLessThanOrEqual(DEFAULT_MAX_RATIO);
  });

  test("fails when a baseline is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ht-visual-"));
    const actual = path.join(dir, "actual.png");
    writeFileSync(actual, solidPng(2, 2, [1, 2, 3, 255]));
    const result = compareShot(actual, path.join(dir, "missing.png"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("missing baseline");
  });
});
