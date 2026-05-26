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

function usesBunSqlite(): boolean {
  return "Bun" in globalThis;
}

function wrapDatabase(db: SqliteDatabase): SqliteDatabase {
  return {
    prepare<Row = unknown>(sql: string) {
      const statement = db.prepare<Row>(sql);
      return {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => {
          const row = statement.get(...params);
          return row ?? undefined;
        },
        all: (...params: unknown[]) => statement.all(...params),
      };
    },
    exec: (sql: string) => db.exec(sql),
    transaction: <T extends (...args: never[]) => unknown>(fn: T) =>
      db.transaction(fn),
    close: () => db.close(),
  };
}

function resolveHarnessdeckDir(): string {
  if (process.env.HARNESSDECK_HOME) {
    return process.env.HARNESSDECK_HOME;
  }
  const homePath = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(homePath, ".harnessdeck");
}

function resolveDbPath(): string {
  return join(resolveHarnessdeckDir(), "harnessdeck.db");
}

function resolveConfigJsoncPath(): string {
  return join(resolveHarnessdeckDir(), "config.jsonc");
}

function resolveLegacyConfigPath(): string {
  return join(resolveHarnessdeckDir(), "config.json");
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function getHarnessdeckDir(): string {
  return resolveHarnessdeckDir();
}

export function getConfigJsoncPath(): string {
  return resolveConfigJsoncPath();
}

export function getLegacyConfigPath(): string {
  return resolveLegacyConfigPath();
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
  const rawDb = new Database(dbPath);
  instance = usesBunSqlite() ? wrapDatabase(rawDb) : rawDb;
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
