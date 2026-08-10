import { getDb } from "../db/connection.js";
import { resolve } from "node:path";
import { ulid } from "ulid";
import type { Project, ProjectPlugin } from "../types.js";

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

export function getProjectByLocalPath(localPath: string): Project | undefined {
  const normalized = resolve(localPath);
  return listProjects().find((project) => resolve(project.local_path) === normalized);
}

export function applyPluginToProject(input: {
  project_id: string;
  plugin_id: string;
  platforms: string[];
}): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO project_plugins (project_id, plugin_id, platforms, applied_at)
     VALUES (?, ?, ?, ?)`,
  ).run(input.project_id, input.plugin_id, JSON.stringify(input.platforms), now);
}

/** @deprecated Use applyPluginToProject */
export function applyConfiguredPluginToProject(input: {
  project_id: string;
  configured_plugin_id: string;
  platforms: string[];
}): void {
  applyPluginToProject({
    project_id: input.project_id,
    plugin_id: input.configured_plugin_id,
    platforms: input.platforms,
  });
}

export function getProjectPlugins(projectId: string): ProjectPlugin[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM project_plugins WHERE project_id = ? ORDER BY applied_at DESC",
    )
    .all(projectId) as Array<Omit<ProjectPlugin, "platforms"> & { platforms: string }>;

  return rows.map((row) => ({
    ...row,
    platforms: JSON.parse(row.platforms) as string[],
  }));
}

/** @deprecated Use getProjectPlugins */
export function getProjectConfiguredPlugins(projectId: string): ProjectPlugin[] {
  return getProjectPlugins(projectId);
}

/** @deprecated Use applyPluginToProject */
export const applyLayerToProject = applyPluginToProject;
/** @deprecated Use applyConfiguredPluginToProject */
export const applyConfiguredLayerToProject = applyConfiguredPluginToProject;
/** @deprecated Use getProjectPlugins */
export const getProjectLayers = getProjectPlugins;
/** @deprecated Use getProjectConfiguredPlugins */
export const getProjectConfiguredLayers = getProjectConfiguredPlugins;
