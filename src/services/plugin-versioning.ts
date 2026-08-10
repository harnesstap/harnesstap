import semver from "semver";
import { ulid } from "ulid";
import { loadSettings } from "../config/settings.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import {
  deletePlugin,
  getPluginByPublishedIdentity,
  getPluginResources,
} from "../models/plugin-model.js";
import type { ClaudePluginConfig, Plugin } from "../types.js";
import { resolveComposition } from "./resolve/index.js";

export type PluginVersionErrorCode =
  | "invalid_version"
  | "same_version"
  | "version_exists"
  | "dirty_plugins"
  | "not_found"
  | "frozen_plugin";

export class PluginVersionError extends Error {
  readonly code: PluginVersionErrorCode;
  readonly dirtyPlugins?: Array<{ name: string; version: string }>;

  constructor(
    code: PluginVersionErrorCode,
    message: string,
    options?: { dirtyPlugins?: Array<{ name: string; version: string }> },
  ) {
    super(message);
    this.name = "PluginVersionError";
    this.code = code;
    this.dirtyPlugins = options?.dirtyPlugins;
  }
}

interface PluginRow {
  id: string;
  name: string;
  version: string;
  org_slug: string;
  catalog_slug: string;
  origin?: string;
  description: string;
  tags: string;
  claude_config: string;
  needs_config: string;
  default_environment_id: string | null;
  dirty: number;
  frozen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PluginWorkingSnapshotPayload {
  resource_ids: string[];
  description: string;
  tags: string[];
  claude_config: string;
  needs_config: string;
  default_environment_id: string | null;
  source_version: string;
  resolved_set: Array<{ name: string; version: string }>;
}

function parseClaudeConfig(raw: string | undefined): ClaudePluginConfig | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as ClaudePluginConfig;
  if (
    (!parsed.marketplaces || Object.keys(parsed.marketplaces).length === 0) &&
    (!parsed.plugins || parsed.plugins.length === 0)
  ) {
    return undefined;
  }
  return parsed;
}

function parseNeedsConfig(raw: string | undefined): string[] | undefined {
  if (!raw || raw === "[]") return undefined;
  const parsed = JSON.parse(raw) as string[];
  return parsed.length > 0 ? parsed : undefined;
}

function rowToPlugin(row: PluginRow): Plugin {
  const claude = parseClaudeConfig(row.claude_config);
  const needs = parseNeedsConfig(row.needs_config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    org_slug: row.org_slug,
    catalog_slug: row.catalog_slug,
    origin: (row.origin as Plugin["origin"]) ?? "authored",
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    dirty: row.dirty === 1,
    ...(row.frozen_at ? { frozen_at: row.frozen_at } : {}),
    ...(claude ? { claude } : {}),
    ...(needs ? { needs } : {}),
    ...(row.default_environment_id
      ? { default_environment_id: row.default_environment_id }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getPluginRowById(pluginId: string): PluginRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM plugins WHERE id = ?").get(pluginId) as
    | PluginRow
    | undefined;
}

function captureWorkingSnapshot(pluginId: string): void {
  const db = getDb();
  const row = getPluginRowById(pluginId);
  if (!row) {
    throw new PluginVersionError("not_found", `Plugin not found: ${pluginId}`);
  }

  const resourceIds = getPluginResources(pluginId).map((resource) => resource.id);
  const resolvedSet = (() => {
    try {
      return resolveComposition({ rootSelectors: [`${row.name}@${row.version}`] })
        .selected.filter((plugin) => plugin.depth > 0)
        .map((plugin) => ({ name: plugin.name, version: plugin.version }));
    } catch {
      // A plugin that does not currently resolve can still be cut; consumers
      // will re-resolve. Record nothing rather than blocking the cut.
      return [];
    }
  })();
  const payload: PluginWorkingSnapshotPayload = {
    resource_ids: resourceIds,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    claude_config: row.claude_config,
    needs_config: row.needs_config,
    default_environment_id: row.default_environment_id,
    source_version: row.version,
    resolved_set: resolvedSet,
  };
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO plugin_working_snapshots (plugin_id, source_version, payload, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(plugin_id) DO UPDATE SET
       source_version = excluded.source_version,
       payload = excluded.payload,
       created_at = excluded.created_at`,
  ).run(pluginId, row.version, JSON.stringify(payload), now);
}

function ensureWorkingSnapshot(pluginId: string): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT plugin_id FROM plugin_working_snapshots WHERE plugin_id = ?")
    .get(pluginId) as { plugin_id: string } | undefined;
  if (!existing) {
    captureWorkingSnapshot(pluginId);
  }
}

function copySnapshotAttachments(pluginId: string, resourceIds: string[]): void {
  const db = getDb();
  for (let order = 0; order < resourceIds.length; order += 1) {
    const resourceId = resourceIds[order];
    if (!resourceId) continue;
    db.prepare(
      `INSERT OR REPLACE INTO plugin_resources (plugin_id, resource_id, "order")
       VALUES (?, ?, ?)`,
    ).run(pluginId, resourceId, order);
  }
}

function isExactPluginVersionReferenced(pluginName: string, version: string): boolean {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.namespace, r.metadata
       FROM resources r
       JOIN plugin_resources lr ON lr.resource_id = r.id
       WHERE r.type = 'plugin' AND r.name = ?`,
    )
    .all(pluginName) as Array<{ namespace: string; metadata: string }>;

  for (const row of rows) {
    const metadata = JSON.parse(row.metadata) as {
      version_constraint?: string;
      resolved_version?: string;
    };
    if (row.namespace === version) {
      return true;
    }
    if (metadata.version_constraint === version) {
      return true;
    }
    if (metadata.resolved_version === version) {
      return true;
    }
  }
  return false;
}

function prunePluginHistory(head: PluginRow): void {
  const limit = loadSettings(getHarnesstapDir()).pluginVersionHistoryLimit;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM plugins
       WHERE name = ? AND org_slug = ? AND catalog_slug = ?
       ORDER BY frozen_at IS NULL DESC, frozen_at ASC, created_at ASC`,
    )
    .all(head.name, head.org_slug, head.catalog_slug) as PluginRow[];

  if (rows.length <= limit) {
    return;
  }

  const frozenRows = rows.filter((row) => row.frozen_at != null);
  let excess = rows.length - limit;

  for (const row of frozenRows) {
    if (excess <= 0) {
      break;
    }
    if (isExactPluginVersionReferenced(head.name, row.version)) {
      console.error(
        `Skipping prune of frozen plugin ${head.name}@${row.version}: still referenced by a plugin dependency`,
      );
      continue;
    }
    deletePlugin(row.id);
    excess -= 1;
  }
}

export function formatPluginVersionLabel(version: string, dirty: boolean): string {
  return dirty ? `${version}*` : version;
}

export function markPluginDirty(pluginId: string): void {
  const row = getPluginRowById(pluginId);
  if (!row) {
    throw new PluginVersionError("not_found", `Plugin not found: ${pluginId}`);
  }
  if (row.frozen_at) {
    throw new PluginVersionError(
      "frozen_plugin",
      `Plugin ${row.name}@${row.version} is frozen and cannot be marked dirty`,
    );
  }
  if (row.dirty === 1) {
    return;
  }

  const db = getDb();
  db.transaction(() => {
    captureWorkingSnapshot(pluginId);
    db.prepare("UPDATE plugins SET dirty = 1, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      pluginId,
    );
  })();
}

export function cutPluginVersion(input: {
  pluginId: string;
  newVersion: string;
}): Plugin {
  const headRow = getPluginRowById(input.pluginId);
  if (!headRow) {
    throw new PluginVersionError("not_found", `Plugin not found: ${input.pluginId}`);
  }
  if (headRow.frozen_at) {
    throw new PluginVersionError(
      "frozen_plugin",
      `Plugin ${headRow.name}@${headRow.version} is frozen and cannot be cut`,
    );
  }

  if (!semver.valid(input.newVersion)) {
    throw new PluginVersionError(
      "invalid_version",
      `Invalid semver version: ${input.newVersion}`,
    );
  }
  if (input.newVersion === headRow.version) {
    throw new PluginVersionError(
      "same_version",
      `New version must differ from current version ${headRow.version}`,
    );
  }

  const existing = getPluginByPublishedIdentity({
    name: headRow.name,
    version: input.newVersion,
    org: headRow.org_slug,
    catalog: headRow.catalog_slug,
  });
  if (existing) {
    throw new PluginVersionError(
      "version_exists",
      `Plugin ${headRow.name}@${input.newVersion} already exists`,
    );
  }

  ensureWorkingSnapshot(headRow.id);

  const db = getDb();
  const cut = db.transaction(() => {
    const snapshot = db
      .prepare(
        "SELECT payload FROM plugin_working_snapshots WHERE plugin_id = ?",
      )
      .get(headRow.id) as { payload: string } | undefined;
    if (!snapshot) {
      throw new PluginVersionError(
        "not_found",
        `Working snapshot missing for plugin ${headRow.id}`,
      );
    }

    const payload = JSON.parse(snapshot.payload) as PluginWorkingSnapshotPayload;
    const now = new Date().toISOString();
    const frozenId = ulid();

    db.prepare(
      `UPDATE plugins
       SET version = ?, dirty = 0, updated_at = ?
       WHERE id = ?`,
    ).run(input.newVersion, now, headRow.id);

    db.prepare(
      `INSERT INTO plugins (
        id, name, version, org_slug, catalog_slug, description, tags,
        claude_config, needs_config, default_environment_id, dirty, frozen_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      frozenId,
      headRow.name,
      payload.source_version,
      headRow.org_slug,
      headRow.catalog_slug,
      payload.description,
      JSON.stringify(payload.tags),
      payload.claude_config,
      payload.needs_config,
      payload.default_environment_id,
      0,
      now,
      now,
      now,
    );

    db.prepare("UPDATE plugins SET overrides = ? WHERE id = ?").run(
      JSON.stringify({
        versions: {},
        resources: {},
        frozen_resolved_set: payload.resolved_set ?? [],
      }),
      frozenId,
    );

    copySnapshotAttachments(frozenId, payload.resource_ids);
    db.prepare("DELETE FROM plugin_working_snapshots WHERE plugin_id = ?").run(
      headRow.id,
    );

    const updatedHead = getPluginRowById(headRow.id);
    if (!updatedHead) {
      throw new PluginVersionError("not_found", `Plugin not found after cut: ${headRow.id}`);
    }
    prunePluginHistory(updatedHead);
    return updatedHead;
  });

  return rowToPlugin(cut());
}

export function assertPluginsCleanForShare(plugins: Plugin[]): void {
  const dirtyPlugins = plugins
    .filter((plugin) => plugin.dirty)
    .map((plugin) => ({ name: plugin.name, version: plugin.version }));
  if (dirtyPlugins.length === 0) {
    return;
  }
  throw new PluginVersionError(
    "dirty_plugins",
    `Cannot share plugins with unpublished edits: ${dirtyPlugins
      .map((plugin) => `${plugin.name}@${plugin.version}`)
      .join(", ")}`,
    { dirtyPlugins },
  );
}

export function getFrozenResolvedSet(
  pluginId: string,
): Array<{ name: string; version: string }> {
  const db = getDb();
  const row = db
    .prepare("SELECT overrides FROM plugins WHERE id = ?")
    .get(pluginId) as { overrides: string } | undefined;
  if (!row) return [];
  const parsed = JSON.parse(row.overrides || "{}") as {
    frozen_resolved_set?: Array<{ name: string; version: string }>;
  };
  return parsed.frozen_resolved_set ?? [];
}
