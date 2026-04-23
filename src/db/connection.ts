import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SqliteDatabase, SqliteDatabaseConstructor } from "./types.js";

const require = createRequire(import.meta.url);

let instance: SqliteDatabase | null = null;
let instancePath: string | null = null;

function resolveDatabaseConstructor(): SqliteDatabaseConstructor {
  if ("Bun" in globalThis) {
    return (require("bun:sqlite") as { Database: SqliteDatabaseConstructor })
      .Database;
  }

  return require("better-sqlite3") as SqliteDatabaseConstructor;
}

function resolveHarnessdeckDir(): string {
  const homePath = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(homePath, ".harnessdeck");
}

function resolveDbPath(): string {
  return join(resolveHarnessdeckDir(), "harnessdeck.db");
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function getHarnessdeckDir(): string {
  return resolveHarnessdeckDir();
}

export function getDb(): SqliteDatabase {
  const dbPath = resolveDbPath();

  if (instance && instancePath === dbPath) {
    return instance;
  }

  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }

  mkdirSync(resolveHarnessdeckDir(), { recursive: true });

  const Database = resolveDatabaseConstructor();
  instance = new Database(dbPath);
  instancePath = dbPath;
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA foreign_keys = ON");

  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }
}
