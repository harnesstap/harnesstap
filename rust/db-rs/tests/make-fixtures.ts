// Records what the original's db layer does, as fixtures for tests/fixtures.rs.
// Run from the repository root: bun rust/db-rs/tests/make-fixtures.ts
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { initializeSchema } from "../../../src/db/schema.ts";
import { statementAffectsStatus } from "../../../src/db/write-generation.ts";
import {
  getConfigJsoncPath,
  getDbPath,
  getHarnesstapDir,
  getLegacyConfigPath,
  harnesstapDirForHomeRoot,
} from "../../../src/db/connection.ts";
import type { SqliteDatabase } from "../../../src/db/types.ts";

const here = "rust/db-rs/tests/fixtures";
const T = "2026-01-01T00:00:00.000Z";

// The same adapter connection.ts puts around bun:sqlite.
function open(): { raw: Database; db: SqliteDatabase } {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const db: SqliteDatabase = {
    prepare(sql: string) {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => statement.run(...(params as [])),
        get: (...params: unknown[]) => statement.get(...(params as [])) ?? undefined,
        all: (...params: unknown[]) => statement.all(...(params as [])),
      };
    },
    exec: (sql: string) => raw.exec(sql),
    transaction: (fn) => raw.transaction(fn as never) as never,
    close: () => raw.close(),
  } as SqliteDatabase;
  return { raw, db };
}

/** Everything a migration can change: the schema, every table's columns and rows. */
function dump(raw: Database): unknown {
  const master = raw
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
    .all();
  const tables = (
    raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string;
    }>
  ).map(({ name }) => {
    const columns = raw.prepare(`PRAGMA table_info("${name}")`).all();
    const rows = (raw.prepare(`SELECT * FROM "${name}"`).all() as unknown[])
      .map((row) => JSON.stringify(row))
      .sort();
    return { name, columns, rows };
  });
  return { master, tables };
}

// Legacy layouts the original's own tests set up (test/db/*.test.ts).
const harvested: string[] = [];
for (const file of ["test/db/schema.test.ts", "test/db/migration-26.test.ts"]) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?:setup:\s*|db\.exec\(\s*)`([^`]*)`/g)) {
    if (!m[1].includes("${") && m[1].includes("schema_version")) harvested.push(m[1]);
  }
}

const V25 = harvested.find((s) => s.includes("VALUES (25)")) ?? "";
const V34 = harvested.find((s) => s.includes("VALUES (34)") && s.includes("global_apply_snapshots")) ?? "";
type Scenario = { name: string; setup: string; init?: boolean; allowLegacyRead?: boolean };
const scenarios: Scenario[] = [
  { name: "fresh", setup: "" },
  { name: "current", setup: "", init: true },
  ...harvested.map((setup, i) => ({ name: `original-test-${i}`, setup })),
  {
    name: "v25 with colliding pin and layer",
    setup: `${V25}
      INSERT INTO layers (id, name, version, created_at, updated_at) VALUES ('L1', 'root', '1.0.0', '${T}', '${T}');
      INSERT INTO resources (id, type, name, metadata, source, namespace, origin_kind, origin_ref, created_at, updated_at) VALUES
        ('PIN1', 'plugin_pin', 'base', '{"version_constraint":"^1"}', 's', 'ns', 'marketplace_link', 'base@ns', '${T}', '${T}'),
        ('LAY1', 'layer', 'base', 'not json', 's', 'ns', 'manual', '', '${T}', '${T}'),
        ('LAY2', 'layer', 'solo', '{}', 's', '', 'manual', '', '${T}', '${T}'),
        ('SK1', 'skill', 'review', '{}', 'manual', '', 'manual', '', '${T}', '${T}');
      INSERT INTO layer_resources (layer_id, resource_id, "order") VALUES ('L1', 'LAY1', 0), ('L1', 'PIN1', 1), ('L1', 'SK1', 2);`,
  },
  {
    name: "v34 with non-semver plugin versions",
    setup: `${V34}
      INSERT INTO plugins (id, name, version, origin_fingerprint, created_at, updated_at) VALUES
        ('p1', 'sha', '9cc65d03aa2d', '9cc65d03aa2dffffffffffff', '${T}', '${T}'),
        ('p2', 'ok', '1.2.3', NULL, '${T}', '${T}'),
        ('p3', 'v', ' v2.0.0-rc.1 ', NULL, '${T}', '${T}'),
        ('p4', 'none', 'latest', NULL, '${T}', '${T}'),
        ('p5', 'fp', 'main', 'ABC-def_123/456.789xyz', '${T}', '${T}');
      INSERT INTO global_apply_snapshots (id, profile_name, created_at) VALUES ('snap1', 'global default', '${T}');`,
  },
  {
    name: "v31 legacy harness tables",
    init: true,
    setup: `
      DROP TABLE harness_preferences;
      DROP TABLE project_harnesses;
      UPDATE schema_version SET version = 31;
      CREATE TABLE harness_preferences (
        scope TEXT PRIMARY KEY, main_harness TEXT NOT NULL DEFAULT '',
        alias_harnesses TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
      );
      CREATE TABLE project_harnesses (
        project_id TEXT PRIMARY KEY, main_harness TEXT NOT NULL DEFAULT '',
        alias_harnesses TEXT NOT NULL DEFAULT '[]', materialization_strategy TEXT NOT NULL DEFAULT 'symlink',
        cursor_skill_mode TEXT, updated_at TEXT NOT NULL
      );
      INSERT INTO projects (id, local_id, created_at) VALUES ('pr1', 'l1', '${T}'), ('pr2', 'l2', '${T}');
      INSERT INTO harness_preferences VALUES
        ('global', 'claude', '["cursor","claude",3,"codex","cursor"]', '${T}'),
        ('empty', '', 'not json', '${T}'),
        ('obj', 'goose', '{"a":"b"}', '${T}'),
        ('esc', 'a"b\\c', '["é\\u2028x", "\\u0001"]', '${T}');
      INSERT INTO project_harnesses VALUES
        ('pr1', 'cursor', '["claude"]', 'copy', 'symlink', '${T}'),
        ('pr2', '', '[]', 'symlink', NULL, '${T}');`,
  },
  { name: "newer than this binary", setup: "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (45);" },
  { name: "too old", setup: "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (21);" },
  {
    name: "too old, legacy read",
    setup: "CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (5);",
    allowLegacyRead: true,
  },
  { name: "empty schema_version table", setup: "CREATE TABLE schema_version (version INTEGER NOT NULL);" },
  {
    name: "current, back to 40",
    init: true,
    setup: "DROP TABLE plugin_excludes; ALTER TABLE apply_removal_backups DROP COLUMN in_trash; DROP TABLE notifications; DROP TABLE upstream_checks; UPDATE schema_version SET version = 40;",
  },
  {
    name: "current, back to 37 with data",
    init: true,
    setup: `ALTER TABLE plugins DROP COLUMN upstream_kind; ALTER TABLE plugins DROP COLUMN upstream_ref; ALTER TABLE plugins DROP COLUMN license; UPDATE schema_version SET version = 37;
      INSERT INTO plugins (id, name, version, created_at, updated_at) VALUES ('p1', 'x', 'abc', '${T}', '${T}');`,
  },
];

const out = scenarios.map((scenario) => {
  const { raw, db } = open();
  if (scenario.init) initializeSchema(db);
  if (scenario.setup) raw.exec(scenario.setup);
  let error: string | null = null;
  try {
    initializeSchema(db, { allowLegacyRead: scenario.allowLegacyRead });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const result = { ...scenario, error, dump: dump(raw) };
  raw.close();
  return result;
});
writeFileSync(`${here}/schema.json`, JSON.stringify(out, null, 1) + "\n");

// statementAffectsStatus
const verbs = ["INSERT INTO", "insert or replace into", "UPDATE", "DELETE FROM", "REPLACE INTO", "CREATE TABLE", "DROP INDEX", "ALTER TABLE", "SELECT * FROM", "PRAGMA x", "WITH t AS (SELECT 1) INSERT INTO", "WITH t AS (SELECT 1) SELECT * FROM", "with recursive t as (select 1) delete from", "INSERTX INTO", "\u00a0\ufeff INSERT INTO", "\u0085INSERT INTO", "INſERT INTO", "\n\t update"];
const tables = ["resources", "resources_x", "upstream_checks", "notifications", "notifications2", "plugins", "UPSTREAM_CHECKS"];
const statements = [];
for (const v of verbs) for (const t of tables) statements.push(`${v} ${t} (a) VALUES (1)`);
statements.push("", ";", "INSERT OR IGNORE INTO notifications VALUES (1)", "INSERT OR \u212a INTO upstream_checks VALUES (1)", "UPDATE  upstream_checks SET x = 1");
writeFileSync(
  `${here}/statements.json`,
  JSON.stringify(statements.map((sql) => ({ sql, affects: statementAffectsStatus(sql) })), null, 1) + "\n",
);

// paths
const envs: Array<Record<string, string>> = [
  { HOME: "/home/u" },
  { HOME: "/home/u/", HARNESSTAP_HOME: "/data/ht" },
  { HOME: "/home/u", HARNESSTAP_HOME: "" },
  { HOME: "" },
  { HOME: "rel//a/./b/../c" },
  { USERPROFILE: "/users/w" },
  { HOME: "/a/../../b", USERPROFILE: "/users/w" },
];
const keys = ["HOME", "USERPROFILE", "HARNESSTAP_HOME"];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
const paths = envs.map((env) => {
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  return {
    env,
    dir: getHarnesstapDir(),
    db: getDbPath(),
    configJsonc: getConfigJsoncPath(),
    legacyConfig: getLegacyConfigPath(),
    forHomeRoot: harnesstapDirForHomeRoot("/root/x/../y"),
  };
});
for (const k of keys) {
  if (saved[k] === undefined) delete process.env[k];
  else process.env[k] = saved[k];
}
writeFileSync(`${here}/paths.json`, JSON.stringify(paths, null, 1) + "\n");
console.log(`schema: ${out.length} scenarios, statements: ${statements.length}, paths: ${paths.length}`);
