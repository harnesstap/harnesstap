import { statusTraceEnabled, traceDb } from "../services/status-trace.js";
import type { SqliteDatabase, SqliteRunResult, SqliteStatement } from "./types.js";

/**
 * Counts committed statements on this thread's connection that can change
 * status output. The status cache compares it instead of the mtime or size
 * of `harnesstap.db`, its `-wal`, or its `-shm` file, which SQLite moves on
 * plain reads and checkpoints.
 */
let statusWriteGeneration = 0;

const WRITE_STATEMENT = /^\s*(?:WITH\b[\s\S]*?\b)?(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

/**
 * `upstream_checks` and `notifications` are read fresh on every status call, outside the cache, so
 * a background update check or a new notification never forces a status recompute.
 *
 * A new library resource is not referenced by any profile, environment, or
 * project until a link row is inserted, and that insert counts. Status does
 * not list unlinked library resources, so a plain insert into `resources`
 * does not count. `INSERT OR REPLACE` can rewrite a linked row, so it counts.
 */
const STATUS_IRRELEVANT_WRITE =
  /^\s*(?:INSERT\s+INTO\s+resources\b|(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:upstream_checks|notifications)\b)/i;

export function statementAffectsStatus(sql: string): boolean {
  if (!WRITE_STATEMENT.test(sql)) return false;
  return !STATUS_IRRELEVANT_WRITE.test(sql);
}

function scriptAffectsStatus(sql: string): boolean {
  return sql
    .split(";")
    .some((part) => part.trim().length > 0 && !/^\s*PRAGMA\b/i.test(part) && statementAffectsStatus(part));
}

export function bumpStatusWriteGeneration(): void {
  statusWriteGeneration += 1;
}

export function readStatusWriteGeneration(): number {
  return statusWriteGeneration;
}

/** Wrap a connection so status-relevant writes bump the generation. */
export function trackStatusWrites(db: SqliteDatabase): SqliteDatabase {
  // Compiling a statement costs more than running most of ours. Reuse them.
  const statements = new Map<string, SqliteStatement<unknown>>();
  const prepareTracked = <Row>(sql: string): SqliteStatement<Row> => {
    const statement = statusTraceEnabled ? timedStatement(sql, db.prepare<Row>(sql)) : db.prepare<Row>(sql);
    if (!statementAffectsStatus(sql)) return statement;
    return {
      run: (...params: unknown[]): SqliteRunResult => {
        const result = statement.run(...params);
        if (result.changes > 0) statusWriteGeneration += 1;
        return result;
      },
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
      };
  };
  return {
    prepare<Row = unknown>(sql: string): SqliteStatement<Row> {
      const cached = statements.get(sql);
      if (cached) return cached as SqliteStatement<Row>;
      const statement = prepareTracked<Row>(sql);
      if (statements.size >= 512) statements.clear();
      statements.set(sql, statement as SqliteStatement<unknown>);
      return statement;
    },
    exec: (sql: string) => {
      // A schema change can invalidate compiled statements.
      if (/\b(CREATE|DROP|ALTER)\b/i.test(sql)) statements.clear();
      db.exec(sql);
      if (scriptAffectsStatus(sql)) statusWriteGeneration += 1;
    },
    transaction: <T extends (...args: never[]) => unknown>(fn: T) => db.transaction(fn),
    close: () => {
      statements.clear();
      db.close();
    },
  };
}

/** Debug only: time each query for the status trace. */
function timedStatement<Row>(sql: string, statement: SqliteStatement<Row>): SqliteStatement<Row> {
  const timed = <R>(fn: () => R): R => {
    const started = performance.now();
    try {
      return fn();
    } finally {
      traceDb(sql, performance.now() - started);
    }
  };
  return {
    run: (...params: unknown[]) => timed(() => statement.run(...params)),
    get: (...params: unknown[]) => timed(() => statement.get(...params)),
    all: (...params: unknown[]) => timed(() => statement.all(...params)),
  };
}
