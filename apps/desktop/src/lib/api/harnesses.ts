import {
  harnessId,
  selectionFrom,
  type DiskPresence,
  type HarnessEntry,
  type HarnessInventory,
  type HarnessLocation,
  type HarnessResourceRow,
  type HarnessSelection,
  type LocationRelation,
  type RegistryPathKey,
} from "../harness-inventory";
import { AgentApiError, agentFetch, throwAgentError } from "./http";

const DISK_PRESENCE = new Set<string>(["detected", "shared-only", "absent"]);
const REGISTRY_PATH_KEYS = new Set<string>([
  "instructions",
  "skills",
  "rules",
  "mcp",
  "permissions",
  "hooks",
  "agents",
  "commands",
  "settings",
  "plugins",
]);
const LOCATION_RELATIONS = new Set<string>([
  "native",
  "shared",
  "host-managed",
  "related",
]);

function malformed(detail: string): AgentApiError {
  return new AgentApiError(
    `Harness inventory is malformed: ${detail}`,
    500,
    "invalid_inventory",
  );
}

function asRecord(value: unknown, detail: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw malformed(detail);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, detail: string): string {
  if (typeof value !== "string") throw malformed(detail);
  return value;
}

function asArray(value: unknown, detail: string): unknown[] {
  if (!Array.isArray(value)) throw malformed(detail);
  return value;
}

function parseResource(value: unknown): HarnessResourceRow {
  const record = asRecord(value, "resource row");
  return {
    id: asString(record.id, "resource id"),
    type: asString(record.type, "resource type"),
    name: asString(record.name, "resource name"),
    description: typeof record.description === "string" ? record.description : "",
    source: asString(record.source, "resource source"),
    origin_kind: typeof record.origin_kind === "string" ? record.origin_kind : null,
    origin_ref: typeof record.origin_ref === "string" ? record.origin_ref : null,
  };
}

function parseLocation(value: unknown): HarnessLocation {
  const record = asRecord(value, "location");
  const surfaces = asArray(record.surfaces, "location surfaces").filter(
    (key): key is RegistryPathKey =>
      typeof key === "string" && REGISTRY_PATH_KEYS.has(key),
  );
  const relationValue = record.relation;
  const relation: LocationRelation =
    typeof relationValue === "string" && LOCATION_RELATIONS.has(relationValue)
      ? (relationValue as LocationRelation)
      : "native";
  return {
    path: asString(record.path, "location path"),
    surfaces,
    onDisk: record.on_disk === true,
    relation,
    relatedFrom:
      typeof record.related_from === "string" && record.related_from.length > 0
        ? record.related_from
        : null,
    resources: asArray(record.resources, "location resources").map(parseResource),
  };
}

function parseEntry(value: unknown): HarnessEntry {
  const record = asRecord(value, "harness entry");
  const disk = asString(record.disk, "harness disk");
  if (!DISK_PRESENCE.has(disk)) throw malformed(`disk ${disk}`);
  return {
    id: harnessId(asString(record.id, "harness id")),
    name: asString(record.name, "harness name"),
    supported: record.supported === true,
    supports: asArray(record.supports ?? [], "harness supports").filter(
      (feature): feature is string => typeof feature === "string",
    ),
    disk: disk as DiskPresence,
    locations: asArray(record.locations ?? [], "harness locations").map(parseLocation),
  };
}

/** Mints `HarnessId`s and drops aliases the catalog does not know. */
export function parseHarnessInventory(body: unknown): HarnessInventory {
  const record = asRecord(body, "body");
  const global = asRecord(record.global, "global");
  const catalog = asArray(record.harnesses, "harnesses").map(parseEntry);
  const known = new Set<string>(catalog.map((entry) => entry.id));

  const main = global.main_harness;
  let selection: HarnessSelection | null = null;
  if (typeof main === "string" && main.length > 0) {
    const aliases = Array.isArray(global.alias_harnesses)
      ? global.alias_harnesses.filter(
          (alias): alias is string => typeof alias === "string" && known.has(alias),
        )
      : [];
    selection = selectionFrom(harnessId(main), aliases.map(harnessId));
  }
  return { selection, catalog };
}

export async function fetchHarnessInventory(
  baseUrl: string,
  token: string | null,
): Promise<HarnessInventory> {
  const response = await agentFetch(baseUrl, token, "/v1/harness/inventory");
  if (!response.ok) {
    return throwAgentError(response, "Could not load harnesses");
  }
  return parseHarnessInventory(await response.json());
}

/**
 * `PUT /v1/harness { global }` then `GET /v1/harness/inventory`. No project
 * block, so the agent writes the preference only and never runs a mirror sync.
 */
export async function saveHarnessSelection(
  baseUrl: string,
  token: string | null,
  next: HarnessSelection,
): Promise<HarnessInventory> {
  const response = await agentFetch(baseUrl, token, "/v1/harness", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      global: { main_harness: next.main, alias_harnesses: [...next.aliases] },
    }),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not save harnesses");
  }
  return fetchHarnessInventory(baseUrl, token);
}

export interface HarnessSyncResult {
  main_harness: string;
  alias_harnesses: string[];
  platforms_synced: string[];
  files_written: number;
}

export async function syncConfiguredHarnesses(
  baseUrl: string,
  token: string | null,
): Promise<HarnessSyncResult> {
  const response = await agentFetch(baseUrl, token, "/v1/harness/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not sync harnesses");
  }
  const body = (await response.json()) as HarnessSyncResult;
  return body;
}
