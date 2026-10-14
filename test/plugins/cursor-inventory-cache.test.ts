import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  clearCursorPluginInstallsCache,
  listCursorPluginInstalls,
} from "../../src/plugins/cursor-inventory.ts";

describe("listCursorPluginInstalls cache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearCursorPluginInstallsCache();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reuses one scan per home within the TTL and returns fresh copies", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-cursor-cache-"));
    dirs.push(home);
    const first = listCursorPluginInstalls(home);
    const second = listCursorPluginInstalls(home);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("bypasses the cache for injected signal collectors", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-cursor-cache-"));
    dirs.push(home);
    let calls = 0;
    const collect = ((root: string) => {
      calls += 1;
      return { enabledNames: new Set<string>(), disabledNames: new Set<string>(), root } as never;
    });
    try { listCursorPluginInstalls(home, collect); } catch {}
    try { listCursorPluginInstalls(home, collect); } catch {}
    expect(calls).toBe(2);
  });
});
