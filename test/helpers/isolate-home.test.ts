import { describe, expect, test } from "bun:test";
import { userInfo } from "node:os";
import { join, sep } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  guardedHarnesstapDirs,
  isolatedTestHome,
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
