import { getDb } from "../db/connection.js";
import type {
  HarnessPreference,
  HarnessSelection,
  ProjectHarnessConfig,
} from "../types.js";

interface HarnessPreferenceRow {
  scope: string;
  main_harness: string;
  alias_harnesses: string;
  updated_at: string;
}

interface ProjectHarnessRow {
  project_id: string;
  main_harness: string;
  alias_harnesses: string;
  materialization_strategy: string;
  updated_at: string;
}

function normalizeSelection(selection: HarnessSelection): HarnessSelection {
  const seen = new Set<string>();
  const alias_harnesses = selection.alias_harnesses.filter((harness) => {
    if (!harness || harness === selection.main_harness || seen.has(harness)) {
      return false;
    }
    seen.add(harness);
    return true;
  });

  return {
    main_harness: selection.main_harness,
    alias_harnesses,
  };
}

function rowToPreference(row: HarnessPreferenceRow): HarnessPreference {
  return {
    main_harness: row.main_harness,
    alias_harnesses: JSON.parse(row.alias_harnesses) as string[],
    updated_at: row.updated_at,
  };
}

function rowToProjectHarness(row: ProjectHarnessRow): ProjectHarnessConfig {
  return {
    project_id: row.project_id,
    main_harness: row.main_harness,
    alias_harnesses: JSON.parse(row.alias_harnesses) as string[],
    materialization_strategy:
      row.materialization_strategy === "copy" ? "copy" : "symlink-preferred",
    updated_at: row.updated_at,
  };
}

export function getHarnessPreference(): HarnessPreference | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM harness_preferences WHERE scope = 'default'")
    .get() as HarnessPreferenceRow | undefined;
  return row ? rowToPreference(row) : undefined;
}

export function setHarnessPreference(
  selection: HarnessSelection,
): HarnessPreference {
  const db = getDb();
  const now = new Date().toISOString();
  const normalized = normalizeSelection(selection);

  db.prepare(
    `INSERT INTO harness_preferences (scope, main_harness, alias_harnesses, updated_at)
     VALUES ('default', ?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET
       main_harness = excluded.main_harness,
       alias_harnesses = excluded.alias_harnesses,
       updated_at = excluded.updated_at`,
  ).run(
    normalized.main_harness,
    JSON.stringify(normalized.alias_harnesses),
    now,
  );

  return {
    ...normalized,
    updated_at: now,
  };
}

export function getProjectHarnessConfig(
  projectId: string,
): ProjectHarnessConfig | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM project_harnesses WHERE project_id = ?")
    .get(projectId) as ProjectHarnessRow | undefined;
  return row ? rowToProjectHarness(row) : undefined;
}

export function setProjectHarnessConfig(input: {
  project_id: string;
  main_harness: string;
  alias_harnesses?: string[];
  materialization_strategy?: "symlink-preferred" | "copy";
}): ProjectHarnessConfig {
  const db = getDb();
  const now = new Date().toISOString();
  const normalized = normalizeSelection({
    main_harness: input.main_harness,
    alias_harnesses: input.alias_harnesses ?? [],
  });
  const materialization_strategy =
    input.materialization_strategy ?? "symlink-preferred";

  db.prepare(
    `INSERT INTO project_harnesses (
       project_id, main_harness, alias_harnesses, materialization_strategy, updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       main_harness = excluded.main_harness,
       alias_harnesses = excluded.alias_harnesses,
       materialization_strategy = excluded.materialization_strategy,
       updated_at = excluded.updated_at`,
  ).run(
    input.project_id,
    normalized.main_harness,
    JSON.stringify(normalized.alias_harnesses),
    materialization_strategy,
    now,
  );

  return {
    project_id: input.project_id,
    ...normalized,
    materialization_strategy,
    updated_at: now,
  };
}
