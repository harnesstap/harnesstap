import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SKILLSET_DIR = join(homedir(), ".skillset");
const DB_PATH = join(SKILLSET_DIR, "skillset.db");

let instance: Database.Database | null = null;

export function getDbPath(): string {
  return DB_PATH;
}

export function getSkillsetDir(): string {
  return SKILLSET_DIR;
}

export function getDb(): Database.Database {
  if (instance) return instance;

  mkdirSync(SKILLSET_DIR, { recursive: true });

  instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
