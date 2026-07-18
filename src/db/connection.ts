import { existsSync, mkdirSync } from "node:fs";
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

function resolveHarnesstapDir(): string {
  if (process.env.HARNESSTAP_HOME) {
    return process.env.HARNESSTAP_HOME;
  }
  const homePath = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(homePath, ".harnesstap");
}

function resolveDbPath(): string {
  return join(resolveHarnesstapDir(), "harnesstap.db");
}

function resolveConfigJsoncPath(): string {
  return join(resolveHarnesstapDir(), "config.jsonc");
}

function resolveLegacyConfigPath(): string {
  return join(resolveHarnesstapDir(), "config.json");
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function getHarnesstapDir(): string {
  return resolveHarnesstapDir();
}

export function getConfigJsoncPath(): string {
  return resolveConfigJsoncPath();
}

export function getLegacyConfigPath(): string {
  return resolveLegacyConfigPath();
}

function isCompletionMode(): boolean {
  return process.env.HARNESSTAP_COMPLETE === "1";
}

export function getDb(): SqliteDatabase {
  const dbPath = resolveDbPath();
  const completionMode = isCompletionMode();

  if (instance && instancePath === dbPath) {
    return instance;
  }

  if (instance) {
    instance.close();
    instance = null;
    instancePath = null;
  }

  if (completionMode) {
    if (!existsSync(dbPath)) {
      throw new Error(`HarnessDeck database not found: ${dbPath}`);
    }
  } else {
    mkdirSync(resolveHarnesstapDir(), { recursive: true });
  }

  const Database = resolveDatabaseConstructor();
  const rawDb = completionMode
    ? new Database(dbPath, { readonly: true })
    : new Database(dbPath);
  instance = usesBunSqlite() ? wrapDatabase(rawDb) : rawDb;
  instancePath = dbPath;
  if (!completionMode) {
    instance.exec("PRAGMA journal_mode = WAL");
  }
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
