import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  clearCursorPluginInstallsCache,
  cursorInventoryInputSignature,
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
    // Create beta's folder before the first scan, without a manifest. On
    // tmpfs (ubuntu-26.04 mounts /tmp that way) a directory's size grows with
    // each entry, and size is part of the signature, so adding the folder
    // later would be a real signature change. Writing the manifest only
    // touches folders below the watched ones.
    const betaManifestDir = join(home, ".cursor", "plugins", "local", "beta", ".cursor-plugin");
    mkdirSync(betaManifestDir, { recursive: true });
    const frozen = new Date("2020-06-01T00:00:00.000Z");
    for (const path of watched) touch(path, frozen);
    const signature = cursorInventoryInputSignature(home);
    expect(listCursorPluginInstalls(home).map((row) => row.name)).toEqual(["alpha"]);

    writeLocalPlugin(home, "beta");
    for (const path of watched) touch(path, frozen);
    expect(cursorInventoryInputSignature(home)).toBe(signature);
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

  it("maps a plugin MCP folder to the cache plugin and does not add an extra row", () => {
    const home = createTempDir("ht-cursor-mcp-cache-ref");
    dirs.push(home);
    const version = join(
      home,
      ".cursor",
      "plugins",
      "cache",
      "cursor-public",
      "context7",
      "abc",
    );
    mkdirSync(join(version, ".cursor-plugin"), { recursive: true });
    writeFileSync(
      join(version, ".cursor-plugin", "plugin.json"),
      JSON.stringify({ name: "context7", version: "1.0.0" }),
    );
    mkdirSync(join(home, ".cursor", "projects", "mcps", "plugin-context7-plugin-context7"), {
      recursive: true,
    });

    const installs = listCursorPluginInstalls(home);
    expect(installs.map((row) => row.ref)).toEqual(["context7@cursor-public"]);
    expect(installs.some((row) => row.ref === "context7-plugin-context7@cursor")).toBe(false);
  });

  it("reads the plugin ref from an MCP folder manifest and dedupes it", () => {
    const home = createTempDir("ht-cursor-mcp-manifest-ref");
    dirs.push(home);
    const version = join(
      home,
      ".cursor",
      "plugins",
      "cache",
      "cursor-public",
      "context7",
      "abc",
    );
    mkdirSync(join(version, ".cursor-plugin"), { recursive: true });
    writeFileSync(
      join(version, ".cursor-plugin", "plugin.json"),
      JSON.stringify({ name: "context7", version: "1.0.0" }),
    );
    const folder = join(home, ".cursor", "projects", "mcps", "plugin-not-a-real-name");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "SERVER_METADATA.json"),
      JSON.stringify({ pluginPath: version }),
    );

    const installs = listCursorPluginInstalls(home);
    expect(installs.filter((row) => row.name === "context7")).toHaveLength(1);
    expect(installs.map((row) => row.ref)).toEqual(["context7@cursor-public"]);
    expect(installs.some((row) => row.ref === "not-a-real-name@cursor")).toBe(false);
  });
});
