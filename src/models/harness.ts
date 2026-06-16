import { getDb } from "../db/connection.js";
import type {
  CursorSkillMode,
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
  cursor_skill_mode: string | null;
  updated_at: string;
}

const CURSOR_SKILL_MODES = new Set<CursorSkillMode>([
  "agent-requested",
  "always-on",
  "agents-skills",
]);

function parseCursorSkillMode(value: string | null | undefined): CursorSkillMode | undefined {
  if (!value) return undefined;
  return CURSOR_SKILL_MODES.has(value as CursorSkillMode)
    ? (value as CursorSkillMode)
    : undefined;
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
  const cursor_skill_mode = parseCursorSkillMode(row.cursor_skill_mode);
  return {
    project_id: row.project_id,
    main_harness: row.main_harness,
    alias_harnesses: JSON.parse(row.alias_harnesses) as string[],
    materialization_strategy:
      row.materialization_strategy === "copy" ? "copy" : "symlink-preferred",
    ...(cursor_skill_mode ? { cursor_skill_mode } : {}),
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
  cursor_skill_mode?: CursorSkillMode;
}): ProjectHarnessConfig {
  const db = getDb();
  const now = new Date().toISOString();
  const normalized = normalizeSelection({
    main_harness: input.main_harness,
    alias_harnesses: input.alias_harnesses ?? [],
  });
  const materialization_strategy =
    input.materialization_strategy ?? "symlink-preferred";
  const existing = getProjectHarnessConfig(input.project_id);
  const cursor_skill_mode =
    input.cursor_skill_mode ?? existing?.cursor_skill_mode;

  db.prepare(
    `INSERT INTO project_harnesses (
       project_id, main_harness, alias_harnesses, materialization_strategy,
       cursor_skill_mode, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       main_harness = excluded.main_harness,
       alias_harnesses = excluded.alias_harnesses,
       materialization_strategy = excluded.materialization_strategy,
       cursor_skill_mode = excluded.cursor_skill_mode,
       updated_at = excluded.updated_at`,
  ).run(
    input.project_id,
    normalized.main_harness,
    JSON.stringify(normalized.alias_harnesses),
    materialization_strategy,
    cursor_skill_mode ?? null,
    now,
  );

  return {
    project_id: input.project_id,
    ...normalized,
    materialization_strategy,
    ...(cursor_skill_mode ? { cursor_skill_mode } : {}),
    updated_at: now,
  };
}
