import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function runBunSqliteSmoke(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO smoke (id) VALUES (1)").run();

    const journalMode = db
      .prepare("PRAGMA journal_mode")
      .get() as { journal_mode: string };
    if (journalMode.journal_mode !== "wal") {
      throw new Error(
        `bun:sqlite: expected journal_mode wal, got ${journalMode.journal_mode}`,
      );
    }

    const row = db.prepare("SELECT id FROM smoke WHERE id = 1").get() as
      | { id: number }
      | null;
    if (!row || row.id !== 1) {
      throw new Error("bun:sqlite: WAL write/read smoke failed");
    }

    console.log("bun:sqlite: WAL write OK");
  } finally {
    db.close();
  }
}

function runNodeSqliteSmoke(dbPath: string): void {
  const result = spawnSync(
    "node",
    [join(scriptDir, "sqlite-wal-write-smoke-node.mjs"), dbPath],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "harnesstap-sqlite-wal-smoke-"));

try {
  runBunSqliteSmoke(join(tempDir, "bun.db"));
  runNodeSqliteSmoke(join(tempDir, "node.db"));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
