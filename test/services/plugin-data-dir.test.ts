import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensurePluginDataDir, pluginDataDirPath } from "../../src/services/plugin-data-dir.ts";
import type { TestContext } from "../helpers/db.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-data-dir-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("ensurePluginDataDir", () => {
  it("creates a directory and records ownership, then reuses it", () => {
    const first = ensurePluginDataDir("core");
    expect(first.created).toBe(true);
    expect(first.warning).toBeUndefined();
    expect(first.path).toBe(pluginDataDirPath("core"));

    const second = ensurePluginDataDir("core");
    expect(second).toEqual({ path: first.path, created: false });

    const row = ctx.connection
      .getDb()
      .prepare("SELECT plugin_name, path FROM plugin_data_dirs")
      .get() as { plugin_name: string; path: string };
    expect(row).toEqual({ plugin_name: "core", path: first.path });
  });

  it("does not claim or remove a directory it did not create", () => {
    const path = pluginDataDirPath("foreign");
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(path);
    writeFileSync(`${path}/notes.txt`, "user");

    const result = ensurePluginDataDir("foreign");
    expect(result.created).toBe(false);
    expect(result.warning).toContain("not owned by HarnessTap");
    expect(result.warning).toContain("left in place");

    const count = ctx.connection
      .getDb()
      .prepare("SELECT COUNT(*) AS n FROM plugin_data_dirs")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("does not replace a path that is a file", () => {
    const path = pluginDataDirPath("blocked");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not a directory");

    const result = ensurePluginDataDir("blocked");
    expect(result.created).toBe(false);
    expect(result.warning).toContain("not a directory");
    expect(result.warning).toContain("left in place");
  });

  it("rejects a name that is not a single path segment", () => {
    expect(() => ensurePluginDataDir("../escape")).toThrow(/plugin data directory/);
  });
});
