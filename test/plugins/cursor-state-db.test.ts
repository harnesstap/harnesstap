import { existsSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  clearCursorStateDbCache,
  collectCursorEnablementSignals,
  cursorLoadsForeignHarnessTrees,
  cursorStateDbPath,
  expireCursorStateKeysThrottle,
  readCursorStateDbOpenCount,
} from "../../src/plugins/cursor-enablement.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

function writeStateDb(
  home: string,
  rows: ReadonlyArray<{ key: string; value: string }>,
): string {
  const dbPath = cursorStateDbPath(home);
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.run("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE, value BLOB)");
  db.run("DELETE FROM ItemTable");
  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  const tx = db.transaction(() => {
    for (const row of rows) insert.run(row.key, row.value);
  });
  tx();
  db.close();
  return dbPath;
}

describe("state.vscdb reads", () => {
  const dirs: string[] = [];
  afterEach(() => {
    clearCursorStateDbCache();
    for (const dir of dirs.splice(0)) cleanupDir(dir);
  });

  it("reads installed ids and known third-party flags by key", () => {
    const home = createTempDir("ht-vscdb-keys");
    dirs.push(home);
    writeStateDb(home, [
      {
        key: "cursor.plugins.installedIds.no-team",
        value: JSON.stringify(["slack", "github"]),
      },
      {
        key: "cursor.recentlyUsed.globalOrder",
        value: JSON.stringify([
          {
            identifier:
              "cache/cursor-public/superpowers/abc/skills/brainstorming/SKILL.md",
          },
        ]),
      },
      {
        key: "cursor.skills.includeThirdPartyPlugins",
        value: JSON.stringify(false),
      },
      {
        key: "noise.blob",
        value: "x".repeat(64 * 1024),
      },
    ]);

    const signals = collectCursorEnablementSignals(home);
    expect([...signals.pluginNames].sort()).toEqual(["github", "slack", "superpowers"]);
    expect(cursorLoadsForeignHarnessTrees(home)).toBe(false);
  });

  it("ignores unknown third-party keys stored only in state.vscdb", () => {
    const home = createTempDir("ht-vscdb-unknown");
    dirs.push(home);
    writeStateDb(home, [
      {
        key: "cursor.obscure.thirdPartyPlugins",
        value: JSON.stringify(false),
      },
    ]);
    expect(cursorLoadsForeignHarnessTrees(home)).toBe(true);
  });

  it("does not create a database when none exists", () => {
    const home = createTempDir("ht-vscdb-missing");
    dirs.push(home);
    const dbPath = cursorStateDbPath(home);
    expect(existsSync(dbPath)).toBe(false);
    expect(cursorLoadsForeignHarnessTrees(home)).toBe(true);
    expect(collectCursorEnablementSignals(home).pluginNames.size).toBe(0);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("reuses parsed rows until key contents change and does not write the file", () => {
    const home = createTempDir("ht-vscdb-cache");
    dirs.push(home);
    const dbPath = writeStateDb(home, [
      {
        key: "cursor.plugins.installedIds.no-team",
        value: JSON.stringify(["slack"]),
      },
    ]);
    const before = statSync(dbPath);
    const opens = readCursorStateDbOpenCount();
    expect([...collectCursorEnablementSignals(home).pluginNames]).toEqual(["slack"]);
    expect([...collectCursorEnablementSignals(home).pluginNames]).toEqual(["slack"]);
    expect(readCursorStateDbOpenCount() - opens).toBe(1);
    const after = statSync(dbPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    const sidecar = readdirSync(join(dbPath, "..")).filter(
      (name) => name.startsWith("state.vscdb-"),
    );
    expect(sidecar).toEqual([]);

    clearCursorStateDbCache();
    expect([...collectCursorEnablementSignals(home).pluginNames]).toEqual(["slack"]);
    expect(readCursorStateDbOpenCount() - opens).toBe(2);

    const later = new Date("2030-01-01T00:00:00.000Z");
    utimesSync(dbPath, later, later);
    expect([...collectCursorEnablementSignals(home).pluginNames]).toEqual(["slack"]);
    expect(readCursorStateDbOpenCount() - opens).toBe(2);

    const db = new Database(dbPath);
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", "noise.unrelated", "churn");
    db.close();
    expect([...collectCursorEnablementSignals(home).pluginNames]).toEqual(["slack"]);
    expect(readCursorStateDbOpenCount() - opens).toBe(2);

    expireCursorStateKeysThrottle();
    const changed = new Database(dbPath);
    changed.run(
      "UPDATE ItemTable SET value = ? WHERE key = ?",
      JSON.stringify(["slack", "docs"]),
      "cursor.plugins.installedIds.no-team",
    );
    changed.close();
    expect([...collectCursorEnablementSignals(home).pluginNames].sort()).toEqual(["docs", "slack"]);
    expect(readCursorStateDbOpenCount() - opens).toBe(3);
  });
});
