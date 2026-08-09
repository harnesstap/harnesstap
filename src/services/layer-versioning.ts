import semver from "semver";
import { ulid } from "ulid";
import { loadSettings } from "../config/settings.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import {
  deleteLayer,
  getLayerByPublishedIdentity,
  getLayerResources,
} from "../models/layer-model.js";
import type { ClaudeLayerConfig, Layer } from "../types.js";

export type LayerVersionErrorCode =
  | "invalid_version"
  | "same_version"
  | "version_exists"
  | "dirty_layers"
  | "not_found"
  | "frozen_layer";

export class LayerVersionError extends Error {
  readonly code: LayerVersionErrorCode;
  readonly dirtyLayers?: Array<{ name: string; version: string }>;

  constructor(
    code: LayerVersionErrorCode,
    message: string,
    options?: { dirtyLayers?: Array<{ name: string; version: string }> },
  ) {
    super(message);
    this.name = "LayerVersionError";
    this.code = code;
    this.dirtyLayers = options?.dirtyLayers;
  }
}

interface LayerRow {
  id: string;
  name: string;
  version: string;
  org_slug: string;
  catalog_slug: string;
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

interface LayerWorkingSnapshotPayload {
  resource_ids: string[];
  description: string;
  tags: string[];
  claude_config: string;
  needs_config: string;
  default_environment_id: string | null;
  source_version: string;
}

function parseClaudeConfig(raw: string | undefined): ClaudeLayerConfig | undefined {
  if (!raw || raw === "{}") return undefined;
  const parsed = JSON.parse(raw) as ClaudeLayerConfig;
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

function rowToLayer(row: LayerRow): Layer {
  const claude = parseClaudeConfig(row.claude_config);
  const needs = parseNeedsConfig(row.needs_config);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    org_slug: row.org_slug,
    catalog_slug: row.catalog_slug,
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

function getLayerRowById(layerId: string): LayerRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM layers WHERE id = ?").get(layerId) as
    | LayerRow
    | undefined;
}

function captureWorkingSnapshot(layerId: string): void {
  const db = getDb();
  const row = getLayerRowById(layerId);
  if (!row) {
    throw new LayerVersionError("not_found", `Layer not found: ${layerId}`);
  }

  const resourceIds = getLayerResources(layerId).map((resource) => resource.id);
  const payload: LayerWorkingSnapshotPayload = {
    resource_ids: resourceIds,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    claude_config: row.claude_config,
    needs_config: row.needs_config,
    default_environment_id: row.default_environment_id,
    source_version: row.version,
  };
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO layer_working_snapshots (layer_id, source_version, payload, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(layer_id) DO UPDATE SET
       source_version = excluded.source_version,
       payload = excluded.payload,
       created_at = excluded.created_at`,
  ).run(layerId, row.version, JSON.stringify(payload), now);
}

function ensureWorkingSnapshot(layerId: string): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT layer_id FROM layer_working_snapshots WHERE layer_id = ?")
    .get(layerId) as { layer_id: string } | undefined;
  if (!existing) {
    captureWorkingSnapshot(layerId);
  }
}

function copySnapshotAttachments(layerId: string, resourceIds: string[]): void {
  const db = getDb();
  for (let order = 0; order < resourceIds.length; order += 1) {
    const resourceId = resourceIds[order];
    if (!resourceId) continue;
    db.prepare(
      `INSERT OR REPLACE INTO layer_resources (layer_id, resource_id, "order")
       VALUES (?, ?, ?)`,
    ).run(layerId, resourceId, order);
  }
}

function isExactLayerVersionReferenced(layerName: string, version: string): boolean {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.namespace, r.metadata
       FROM resources r
       JOIN layer_resources lr ON lr.resource_id = r.id
       WHERE r.type = 'layer' AND r.name = ?`,
    )
    .all(layerName) as Array<{ namespace: string; metadata: string }>;

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

function pruneLayerHistory(head: LayerRow): void {
  const limit = loadSettings(getHarnesstapDir()).layerVersionHistoryLimit;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM layers
       WHERE name = ? AND org_slug = ? AND catalog_slug = ?
       ORDER BY frozen_at IS NULL DESC, frozen_at ASC, created_at ASC`,
    )
    .all(head.name, head.org_slug, head.catalog_slug) as LayerRow[];

  if (rows.length <= limit) {
    return;
  }

  const frozenRows = rows.filter((row) => row.frozen_at != null);
  let excess = rows.length - limit;

  for (const row of frozenRows) {
    if (excess <= 0) {
      break;
    }
    if (isExactLayerVersionReferenced(head.name, row.version)) {
      console.error(
        `Skipping prune of frozen layer ${head.name}@${row.version}: still referenced by a layer dependency`,
      );
      continue;
    }
    deleteLayer(row.id);
    excess -= 1;
  }
}

export function formatLayerVersionLabel(version: string, dirty: boolean): string {
  return dirty ? `${version}*` : version;
}

export function markLayerDirty(layerId: string): void {
  const row = getLayerRowById(layerId);
  if (!row) {
    throw new LayerVersionError("not_found", `Layer not found: ${layerId}`);
  }
  if (row.frozen_at) {
    throw new LayerVersionError(
      "frozen_layer",
      `Layer ${row.name}@${row.version} is frozen and cannot be marked dirty`,
    );
  }
  if (row.dirty === 1) {
    return;
  }

  const db = getDb();
  db.transaction(() => {
    captureWorkingSnapshot(layerId);
    db.prepare("UPDATE layers SET dirty = 1, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      layerId,
    );
  })();
}

export function cutLayerVersion(input: {
  layerId: string;
  newVersion: string;
}): Layer {
  const headRow = getLayerRowById(input.layerId);
  if (!headRow) {
    throw new LayerVersionError("not_found", `Layer not found: ${input.layerId}`);
  }
  if (headRow.frozen_at) {
    throw new LayerVersionError(
      "frozen_layer",
      `Layer ${headRow.name}@${headRow.version} is frozen and cannot be cut`,
    );
  }

  if (!semver.valid(input.newVersion)) {
    throw new LayerVersionError(
      "invalid_version",
      `Invalid semver version: ${input.newVersion}`,
    );
  }
  if (input.newVersion === headRow.version) {
    throw new LayerVersionError(
      "same_version",
      `New version must differ from current version ${headRow.version}`,
    );
  }

  const existing = getLayerByPublishedIdentity({
    name: headRow.name,
    version: input.newVersion,
    org: headRow.org_slug,
    catalog: headRow.catalog_slug,
  });
  if (existing) {
    throw new LayerVersionError(
      "version_exists",
      `Layer ${headRow.name}@${input.newVersion} already exists`,
    );
  }

  ensureWorkingSnapshot(headRow.id);

  const db = getDb();
  const cut = db.transaction(() => {
    const snapshot = db
      .prepare(
        "SELECT payload FROM layer_working_snapshots WHERE layer_id = ?",
      )
      .get(headRow.id) as { payload: string } | undefined;
    if (!snapshot) {
      throw new LayerVersionError(
        "not_found",
        `Working snapshot missing for layer ${headRow.id}`,
      );
    }

    const payload = JSON.parse(snapshot.payload) as LayerWorkingSnapshotPayload;
    const now = new Date().toISOString();
    const frozenId = ulid();

    db.prepare(
      `UPDATE layers
       SET version = ?, dirty = 0, updated_at = ?
       WHERE id = ?`,
    ).run(input.newVersion, now, headRow.id);

    db.prepare(
      `INSERT INTO layers (
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

    copySnapshotAttachments(frozenId, payload.resource_ids);
    db.prepare("DELETE FROM layer_working_snapshots WHERE layer_id = ?").run(
      headRow.id,
    );

    const updatedHead = getLayerRowById(headRow.id);
    if (!updatedHead) {
      throw new LayerVersionError("not_found", `Layer not found after cut: ${headRow.id}`);
    }
    pruneLayerHistory(updatedHead);
    return updatedHead;
  });

  return rowToLayer(cut());
}

export function assertLayersCleanForShare(layers: Layer[]): void {
  const dirtyLayers = layers
    .filter((layer) => layer.dirty)
    .map((layer) => ({ name: layer.name, version: layer.version }));
  if (dirtyLayers.length === 0) {
    return;
  }
  throw new LayerVersionError(
    "dirty_layers",
    `Cannot share layers with unpublished edits: ${dirtyLayers
      .map((layer) => `${layer.name}@${layer.version}`)
      .join(", ")}`,
    { dirtyLayers },
  );
}
