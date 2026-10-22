import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, sep } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  guardedHarnesstapDirs,
  isolatedTempRoot,
  isolatedTestHome,
  leakedTempEntries,
  realTempDir,
} from "./isolate-home.ts";

describe("test home isolation preload", () => {
  test("HOME points at a throwaway directory", () => {
    expect(process.env.HOME).toBe(isolatedTestHome);
    expect(process.env.HARNESSTAP_TEST_HOME_ROOT).toBe(isolatedTestHome);
    expect(isolatedTestHome).not.toBe(userInfo().homedir);
  });

  test("the HarnessTap data dir follows the temporary HOME", () => {
    expect(process.env.HARNESSTAP_HOME).toBeUndefined();
    expect(getHarnesstapDir()).toBe(join(isolatedTestHome, ".harnesstap"));
  });

  test("the real home's .harnesstap is guarded", () => {
    expect(guardedHarnesstapDirs).toContain(
      join(userInfo().homedir, ".harnesstap"),
    );
    for (const dir of guardedHarnesstapDirs) {
      expect(dir.startsWith(isolatedTestHome + sep)).toBe(false);
    }
  });
});

describe("test temp dir isolation preload", () => {
  test("os.tmpdir() points at the per-run temp root", () => {
    expect(tmpdir()).toBe(isolatedTempRoot);
    expect(process.env.TMPDIR).toBe(isolatedTempRoot);
    expect(isolatedTempRoot.startsWith(realTempDir + sep)).toBe(true);
    const made = mkdtempSync(join(tmpdir(), "ht-isolation-probe-"));
    expect(made.startsWith(isolatedTempRoot + sep)).toBe(true);
  });

  test("leak detection reports only new HarnessTap entries from this run", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-leak-probe-"));
    try {
      mkdirSync(join(dir, "ht-existing"));
      mkdirSync(join(dir, "ht-old"));
      const old = new Date(Date.now() - 3_600_000);
      utimesSync(join(dir, "ht-old"), old, old);
      const startedAt = Date.now();
      mkdirSync(join(dir, "ht-new-abc"));
      mkdirSync(join(dir, "harnesstap-new-def"));
      mkdirSync(join(dir, "other-tool-xyz"));
      expect(leakedTempEntries(dir, new Set(["ht-existing"]), startedAt)).toEqual([
        join(dir, "harnesstap-new-def"),
        join(dir, "ht-new-abc"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
