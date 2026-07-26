import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: node sqlite-wal-write-smoke-node.mjs <db-path>");
  process.exit(1);
}

const db = new Database(dbPath);
try {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY)");
  db.prepare("INSERT INTO smoke (id) VALUES (1)").run();

  const journalMode = db.pragma("journal_mode", { simple: true });
  if (journalMode !== "wal") {
    throw new Error(`better-sqlite3: expected journal_mode wal, got ${journalMode}`);
  }

  const row = db.prepare("SELECT id FROM smoke WHERE id = 1").get();
  if (!row || row.id !== 1) {
    throw new Error("better-sqlite3: WAL write/read smoke failed");
  }

  console.log("better-sqlite3: WAL write OK");
} finally {
  db.close();
}
