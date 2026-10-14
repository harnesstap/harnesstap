import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  clearCursorPluginInstallsCache,
  listCursorPluginInstalls,
} from "../../src/plugins/cursor-inventory.ts";
import { createTempDir, cleanupDir } from "../helpers/fs.ts";

function writeLocalPlugin(home: string, name: string): void {
  const dir = join(home, ".cursor", "plugins", "local", name, ".cursor-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" }),
  );
}

function touch(path: string, at: Date): void {
  utimesSync(path, at, at);
}

describe("listCursorPluginInstalls cache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearCursorPluginInstallsCache();
    for (const dir of dirs.splice(0)) cleanupDir(dir);
  });

  it("reuses one scan until a watched mtime changes and returns fresh copies", () => {
    const home = createTempDir("ht-cursor-cache");
    dirs.push(home);
    writeLocalPlugin(home, "alpha");
    const first = listCursorPluginInstalls(home);
    const second = listCursorPluginInstalls(home);
    expect(second.map((row) => row.name)).toEqual(["alpha"]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);

    writeLocalPlugin(home, "beta");
    const pluginsDir = join(home, ".cursor", "plugins");
    const later = new Date("2030-01-01T00:00:00.000Z");
    touch(pluginsDir, later);
    const third = listCursorPluginInstalls(home);
    expect(third.map((row) => row.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("drops the scan on an explicit clear even when watched mtimes are restored", () => {
    const home = createTempDir("ht-cursor-cache-clear");
    dirs.push(home);
    writeLocalPlugin(home, "alpha");
    const watched = [
      join(home, ".cursor", "plugins"),
      join(home, ".cursor", "plugins", "local"),
    ];
    const frozen = new Date("2020-06-01T00:00:00.000Z");
    for (const path of watched) touch(path, frozen);
    expect(listCursorPluginInstalls(home).map((row) => row.name)).toEqual(["alpha"]);

    writeLocalPlugin(home, "beta");
    for (const path of watched) touch(path, frozen);
    expect(listCursorPluginInstalls(home).map((row) => row.name)).toEqual(["alpha"]);

    clearCursorPluginInstallsCache();
    expect(listCursorPluginInstalls(home).map((row) => row.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("keeps only the newest cache version and counts an MCP-only plugin", () => {
    const home = createTempDir("ht-cursor-newest-sha");
    dirs.push(home);
    const older = join(home, ".cursor", "plugins", "cache", "cursor-public", "demo", "aaa");
    const newer = join(home, ".cursor", "plugins", "cache", "cursor-public", "demo", "zzz");
    mkdirSync(join(older, ".cursor-plugin"), { recursive: true });
    mkdirSync(join(newer, ".cursor-plugin"), { recursive: true });
    writeFileSync(
      join(older, ".cursor-plugin", "plugin.json"),
      JSON.stringify({ name: "demo", version: "1.0.0" }),
    );
    writeFileSync(
      join(newer, ".cursor-plugin", "plugin.json"),
      JSON.stringify({ name: "demo", version: "2.0.0" }),
    );
    const oldStamp = new Date("2020-01-01T00:00:00.000Z");
    const newStamp = new Date("2026-01-01T00:00:00.000Z");
    touch(older, oldStamp);
    touch(newer, newStamp);
    mkdirSync(join(home, ".cursor", "projects", "mcps", "plugin-slack-slack"), {
      recursive: true,
    });

    const installs = listCursorPluginInstalls(home);
    const demo = installs.filter((row) => row.name === "demo");
    expect(demo).toHaveLength(1);
    expect(demo[0]).toMatchObject({
      version: "2.0.0",
      enabled: true,
      installPath: newer,
    });
    expect(installs.find((row) => row.name === "slack")).toMatchObject({
      ref: "slack@cursor",
      enabled: true,
    });
  });
});
