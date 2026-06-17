export interface SqliteRunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface SqliteStatement<Row = unknown> {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface SqliteDatabase {
  prepare<Row = unknown>(sql: string): SqliteStatement<Row>;
  exec(sql: string): void;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

export interface SqliteDatabaseOptions {
  readonly?: boolean;
}

export interface SqliteDatabaseConstructor {
  new (path: string, options?: SqliteDatabaseOptions): SqliteDatabase;
}
