import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import { mapResourceRow } from "./resource.js";
import { normalizeResourceInput, upsertResource } from "./resource.js";
import type {
  Environment,
  EnvironmentSecretRef,
  EnvironmentSecretProvider,
  EnvVarMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
  Resource,
} from "../types.js";

type EnvironmentResourceType = "env_var" | "model_config" | "permission";

interface EnvironmentRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ResourceRow {
  id: string;
  type: string;
  name: string;
  description: string;
  content: string;
  metadata: string;
  source: string;
  namespace?: string;
  origin_kind?: string;
  origin_ref?: string;
  content_hash?: string;
  content_blob_ref?: string;
  created_at: string;
  updated_at: string;
  order: number;
}

interface EnvironmentSecretRefRow {
  environment_id: string;
  key: string;
  provider: string;
  ref: string;
}

interface EnvironmentReferenceRow {
  id: string;
  name: string;
}

export interface EnvironmentLookupResult {
  status: "found" | "not_found" | "ambiguous";
  environment?: Environment;
  matches?: Environment[];
}

export interface EnvironmentReferenceSummary {
  configured_layers: Array<{ id: string; name: string }>;
  decks: Array<{ id: string; name: string }>;
}

function findEnvironmentByIdPrefix(prefix: string): Environment[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM environments
       WHERE id LIKE ?
       ORDER BY name`,
    )
    .all(`${prefix}%`) as EnvironmentRow[];
  return rows.map(rowToEnvironment);
}

export function resolveEnvironmentSelector(selector: string): EnvironmentLookupResult {
  if (/^[0-9A-Z]{26}$/.test(selector)) {
    const byId = getEnvironment(selector);
    if (byId) {
      return { status: "found", environment: byId };
    }
  }

  const byName = getEnvironmentByName(selector);
  if (byName) {
    return { status: "found", environment: byName };
  }

  const byPrefix = findEnvironmentByIdPrefix(selector);
  if (byPrefix.length === 1) {
    const [environment] = byPrefix;
    if (!environment) {
      return { status: "not_found" };
    }
    return { status: "found", environment };
  }
  if (byPrefix.length > 1) {
    return { status: "ambiguous", matches: byPrefix };
  }

  return { status: "not_found" };
}

function upsertEnvironmentResource(
  environmentId: string,
  input: {
    type: EnvironmentResourceType;
    name: string;
    metadata: EnvVarMetadata | ModelConfigMetadata | PermissionMetadata;
  },
): Resource {
  const environment = getEnvironment(environmentId);
  if (!environment) {
    throw new Error(`Environment not found: ${environmentId}`);
  }

  const result = upsertResource(
    normalizeResourceInput({
      type: input.type,
      name: input.name,
      namespace: environment.name,
      description: "",
      content: "",
      metadata: input.metadata,
      source: `environment:${environment.name}`,
      origin_kind: "manual",
      origin_ref: `environment:${environment.id}`,
    }),
    { policy: "overwrite" },
  );

  if (result.action === "skipped") {
    throw new Error(
      `Failed to upsert environment resource: ${input.type}:${input.name}`,
    );
  }
  addResourceToEnvironment(environment.id, result.resource);
  return result.resource;
}

function listEnvironmentResourcesByType(
  environmentId: string,
  type: EnvironmentResourceType,
): Resource[] {
  return getEnvironmentResources(environmentId).filter(
    (resource) => resource.type === type,
  );
}

function removeEnvironmentResource(environmentId: string, resourceId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM environment_resources
       WHERE environment_id = ? AND resource_id = ?`,
    )
    .run(environmentId, resourceId);
  return result.changes > 0;
}

function rowToEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createEnvironment(input: {
  name: string;
  description?: string;
}): Environment {
  const db = getDb();
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO environments (id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.description ?? "", now, now);

  return {
    id,
    name: input.name,
    description: input.description ?? "",
    created_at: now,
    updated_at: now,
  };
}

export function getEnvironment(id: string): Environment | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE id = ?")
    .get(id) as EnvironmentRow | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function getEnvironmentByName(name: string): Environment | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM environments WHERE name = ?")
    .get(name) as EnvironmentRow | undefined;
  return row ? rowToEnvironment(row) : undefined;
}

export function listEnvironments(): Environment[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM environments ORDER BY name")
    .all() as EnvironmentRow[];
  return rows.map(rowToEnvironment);
}

export function deleteEnvironment(environmentId: string): boolean {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM environments WHERE id = ?")
    .run(environmentId);
  return result.changes > 0;
}

export function upsertEnvironmentEnvVar(
  environmentId: string,
  key: string,
  value: string,
): Resource {
  return upsertEnvironmentResource(environmentId, {
    type: "env_var",
    name: key,
    metadata: { key, value },
  });
}

export function removeEnvironmentEnvVar(
  environmentId: string,
  key: string,
): boolean {
  const matches = listEnvironmentResourcesByType(environmentId, "env_var").filter(
    (resource) => {
      const metadata = resource.metadata as EnvVarMetadata;
      return metadata.key === key || resource.name === key;
    },
  );
  let removed = false;
  for (const match of matches) {
    removed = removeEnvironmentResource(environmentId, match.id) || removed;
  }
  return removed;
}

export function upsertEnvironmentModelConfig(
  environmentId: string,
  input: {
    model: string;
    provider?: string;
    name?: string;
  },
): Resource {
  return upsertEnvironmentResource(environmentId, {
    type: "model_config",
    name: input.name ?? "default",
    metadata: {
      model: input.model,
      ...(input.provider ? { provider: input.provider } : {}),
    },
  });
}

export function removeEnvironmentModelConfig(
  environmentId: string,
  name = "default",
): boolean {
  const matches = listEnvironmentResourcesByType(
    environmentId,
    "model_config",
  ).filter((resource) => resource.name === name);
  let removed = false;
  for (const match of matches) {
    removed = removeEnvironmentResource(environmentId, match.id) || removed;
  }
  return removed;
}

function permissionResourceName(
  permission: Pick<PermissionMetadata, "action" | "pattern">,
): string {
  return `${permission.action}-${permission.pattern}`;
}

export function upsertEnvironmentPermission(
  environmentId: string,
  permission: PermissionMetadata & { name?: string },
): Resource {
  return upsertEnvironmentResource(environmentId, {
    type: "permission",
    name: permission.name ?? permissionResourceName(permission),
    metadata: {
      action: permission.action,
      pattern: permission.pattern,
    },
  });
}

export function removeEnvironmentPermission(
  environmentId: string,
  selector: {
    name?: string;
    action?: PermissionMetadata["action"];
    pattern?: string;
  },
): boolean {
  const matches = listEnvironmentResourcesByType(environmentId, "permission").filter(
    (resource) => {
      const metadata = resource.metadata as PermissionMetadata;
      if (selector.name && resource.name !== selector.name) return false;
      if (selector.action && metadata.action !== selector.action) return false;
      if (selector.pattern && metadata.pattern !== selector.pattern) return false;
      return true;
    },
  );
  let removed = false;
  for (const match of matches) {
    removed = removeEnvironmentResource(environmentId, match.id) || removed;
  }
  return removed;
}

export function listEnvironmentReferences(
  environmentId: string,
): EnvironmentReferenceSummary {
  const db = getDb();
  const configuredLayerRows = db
    .prepare(
      `SELECT id, name
       FROM layers
       WHERE default_environment_id = ?
       ORDER BY name`,
    )
    .all(environmentId) as EnvironmentReferenceRow[];
  const deckRows = db
    .prepare(
      `SELECT id, name
       FROM decks
       WHERE active_environment_id = ?
       ORDER BY name`,
    )
    .all(environmentId) as EnvironmentReferenceRow[];
  return {
    configured_layers: configuredLayerRows,
    decks: deckRows,
  };
}

export function hasEnvironmentReferences(environmentId: string): boolean {
  const refs = listEnvironmentReferences(environmentId);
  return refs.configured_layers.length > 0 || refs.decks.length > 0;
}

export function addResourceToEnvironment(
  environmentId: string,
  resource: { id: string },
): void {
  const db = getDb();
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM environment_resources WHERE environment_id = ?',
    )
    .get(environmentId) as { max_order: number };

  db.prepare(
    'INSERT OR IGNORE INTO environment_resources (environment_id, resource_id, "order") VALUES (?, ?, ?)',
  ).run(environmentId, resource.id, maxOrder.max_order + 1);
}

export function removeResourceFromEnvironment(
  environmentId: string,
  resourceId: string,
): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM environment_resources WHERE environment_id = ? AND resource_id = ?",
  ).run(environmentId, resourceId);
}

export function getEnvironmentResources(environmentId: string): Resource[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.*, er."order" FROM resources r
       JOIN environment_resources er ON er.resource_id = r.id
       WHERE er.environment_id = ?
       ORDER BY er."order"`,
    )
    .all(environmentId) as ResourceRow[];

  return rows.map(mapResourceRow);
}

export function addSecretRefToEnvironment(
  environmentId: string,
  key: string,
  provider: EnvironmentSecretProvider,
  ref: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO environment_secret_refs (environment_id, key, provider, ref)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(environment_id, key) DO UPDATE SET provider = excluded.provider, ref = excluded.ref`,
  ).run(environmentId, key, provider, ref);
}

export function getEnvironmentSecretRefs(
  environmentId: string,
): EnvironmentSecretRef[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM environment_secret_refs WHERE environment_id = ? ORDER BY key",
    )
    .all(environmentId) as EnvironmentSecretRefRow[];

  return rows.map((row) => ({
    environment_id: row.environment_id,
    key: row.key,
    provider: row.provider as EnvironmentSecretProvider,
    ref: row.ref,
  }));
}

export function removeSecretRefFromEnvironment(
  environmentId: string,
  key: string,
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      "DELETE FROM environment_secret_refs WHERE environment_id = ? AND key = ?",
    )
    .run(environmentId, key);
  return result.changes > 0;
}
