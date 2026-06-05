import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type { Project, ProjectConfiguredLayer } from "../types.js";

export function createProject(input: {
  git_origin: string;
  name: string;
  local_path: string;
}): Project {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO projects (id, git_origin, name, local_path, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.git_origin, input.name, input.local_path, now);

  return { id, ...input, created_at: now };
}

export function getProjectByOrigin(gitOrigin: string): Project | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM projects WHERE git_origin = ?")
    .get(gitOrigin) as Project | undefined;
}

export function getProject(id: string): Project | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | Project
    | undefined;
}

export function upsertProject(input: {
  git_origin: string;
  name: string;
  local_path: string;
}): Project {
  const existing = getProjectByOrigin(input.git_origin);
  if (existing) {
    const db = getDb();
    db.prepare("UPDATE projects SET local_path = ?, name = ? WHERE id = ?").run(
      input.local_path,
      input.name,
      existing.id,
    );
    return { ...existing, local_path: input.local_path, name: input.name };
  }
  return createProject(input);
}

export function listProjects(): Project[] {
  const db = getDb();
  return db.prepare("SELECT * FROM projects ORDER BY name").all() as Project[];
}

export function applyConfiguredLayerToProject(input: {
  project_id: string;
  configured_layer_id: string;
  platforms: string[];
}): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO project_configured_layers (project_id, configured_layer_id, platforms, applied_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    input.project_id,
    input.configured_layer_id,
    JSON.stringify(input.platforms),
    now,
  );
}

export function getProjectConfiguredLayers(
  projectId: string,
): ProjectConfiguredLayer[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM project_configured_layers WHERE project_id = ? ORDER BY applied_at DESC",
    )
    .all(projectId) as Array<
    Omit<ProjectConfiguredLayer, "platforms"> & { platforms: string }
  >;

  return rows.map((row) => ({
    ...row,
    platforms: JSON.parse(row.platforms) as string[],
  }));
}

/** @deprecated Use applyConfiguredLayerToProject */
export function applyLayerToProject(input: {
  project_id: string;
  layer_id: string;
  platforms: string[];
}): void {
  applyConfiguredLayerToProject({
    project_id: input.project_id,
    configured_layer_id: input.layer_id,
    platforms: input.platforms,
  });
}

/** @deprecated Use getProjectConfiguredLayers */
export function getProjectLayers(projectId: string): Array<{
  project_id: string;
  layer_id: string;
  platforms: string[];
  applied_at: string;
}> {
  return getProjectConfiguredLayers(projectId).map((row) => ({
    project_id: row.project_id,
    layer_id: row.configured_layer_id,
    platforms: row.platforms,
    applied_at: row.applied_at,
  }));
}
