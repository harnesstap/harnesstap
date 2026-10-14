import { mkdirSync, readdirSync, statSync, utimesSync, writeFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { cursorUserDataDir } from "../../src/plugins/cursor-enablement.ts";
import {
  clearCursorPluginsLogCache,
  readCursorLocalPluginLoadLog,
  readCursorPluginsLogWalkCount,
} from "../../src/plugins/cursor-local-plugin.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

function logsDir(home: string): string {
  return join(cursorUserDataDir(home), "logs");
}

function fullWalkCount(dir: string, depth: number): number {
  if (depth > 6) return 0;
  let count = 0;
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    count += 1;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += fullWalkCount(absolute, depth + 1);
    } else if (entry.isFile() && entry.name.startsWith("Cursor Plugins")) {
      statSync(absolute);
    }
  }
  return count;
}

describe("Cursor Plugins log lookup", () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearCursorPluginsLogCache();
    for (const dir of dirs.splice(0)) cleanupDir(dir);
  });

  it("reads the log in the newest session folder", () => {
    const home = createTempDir("ht-cursor-log");
    dirs.push(home);
    const root = logsDir(home);
    const older = join(root, "20200101T000000", "window1", "exthost");
    const newer = join(root, "20261014T010000", "window1", "exthost", "output");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    writeFileSync(join(older, "Cursor Plugins.log"), "loadUserLocalPlugin old loaded\n");
    writeFileSync(join(newer, "Cursor Plugins.log"), "loadUserLocalPlugin fresh loaded\n");
    const oldDirStamp = new Date("2020-01-01T00:00:00.000Z");
    const oldFileStamp = new Date("2030-01-01T00:00:00.000Z");
    utimesSync(join(root, "20200101T000000"), oldDirStamp, oldDirStamp);
    utimesSync(join(older, "Cursor Plugins.log"), oldFileStamp, oldFileStamp);
    const newStamp = new Date("2024-01-01T00:00:00.000Z");
    utimesSync(join(root, "20261014T010000"), newStamp, newStamp);

    const walks = readCursorPluginsLogWalkCount();
    const log = readCursorLocalPluginLoadLog(home);
    expect(log?.text).toContain("fresh");
    expect(log?.text).not.toContain("old loaded");
    expect(readCursorPluginsLogWalkCount() - walks).toBe(1);
    expect(readCursorLocalPluginLoadLog(home)?.text).toContain("fresh");
    expect(readCursorPluginsLogWalkCount() - walks).toBe(1);
  });

  it("checks only the newest session of a large logs tree", () => {
    const home = createTempDir("ht-cursor-log-perf");
    dirs.push(home);
    const root = logsDir(home);
    const sessions = 2500;
    for (let index = 0; index < sessions; index += 1) {
      const dir = join(root, `s${String(index).padStart(4, "0")}`, "w", "e", "o");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "noise.log"), "x\n");
    }
    const newest = join(root, "s9999", "w", "e", "o");
    mkdirSync(newest, { recursive: true });
    writeFileSync(join(newest, "Cursor Plugins.log"), "loadUserLocalPlugin demo loaded\n");

    const walkStarted = performance.now();
    const visited = fullWalkCount(root, 0);
    const fullWalkMs = performance.now() - walkStarted;
    expect(visited).toBeGreaterThan(sessions);

    const started = performance.now();
    const log = readCursorLocalPluginLoadLog(home);
    const elapsed = performance.now() - started;
    expect(log?.text).toContain("demo loaded");
    expect(elapsed).toBeLessThan(fullWalkMs / 2);
  });
});
