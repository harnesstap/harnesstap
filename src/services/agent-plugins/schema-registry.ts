/**
 * Known Agent Plugins schema identifiers.
 *
 * The spec selects its rules by the exact `$schema` value and clients must
 * never fetch a schema at load time. HarnessTap emits only the canonical
 * identifier of the version it targets (1.0.0). Older HarnessTap builds wrote
 * non-spec identifiers; those are accepted on read and upgraded in memory.
 */

export type ApSpecVersion = "1.0.0";

export interface ApSchemaVersion {
  version: ApSpecVersion;
  /** Canonical `plugin.json` `$schema`. */
  plugin: string;
  /** Canonical `mcp.json` `$schema`. */
  mcp: string;
}

export const AP_SCHEMA_VERSIONS: Readonly<Record<ApSpecVersion, ApSchemaVersion>> = {
  "1.0.0": {
    version: "1.0.0",
    plugin: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    mcp: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  },
};

/** The spec version HarnessTap writes. */
export const AP_CURRENT_VERSION: ApSchemaVersion = AP_SCHEMA_VERSIONS["1.0.0"];

export const AP_SCHEMA_URL = AP_CURRENT_VERSION.plugin;
export const AP_MCP_SCHEMA_URL = AP_CURRENT_VERSION.mcp;

/**
 * Identifiers older HarnessTap releases wrote into `plugin.json`. They were
 * never spec identifiers. Read compat only: never emit them.
 */
export const AP_LEGACY_SCHEMA_URLS: readonly string[] = [
  "https://agentplugins.org/schema/v1/plugin.schema.json",
  "https://agentplugins.org/schemas/v1/plugin.json",
];

const SPEC_SCHEMA_PREFIX = "https://agent-plugins.org/schemas/";

export type ApSchemaLookup =
  | { kind: "current"; version: ApSchemaVersion }
  | { kind: "legacy"; upgradeTo: string }
  | { kind: "unsupported-spec" }
  | { kind: "unknown" };

/** Classify a `plugin.json` `$schema` value. Exact matches only. */
export function lookupApSchema(schema: string): ApSchemaLookup {
  for (const version of Object.values(AP_SCHEMA_VERSIONS)) {
    if (schema === version.plugin) return { kind: "current", version };
  }
  if (AP_LEGACY_SCHEMA_URLS.includes(schema)) {
    return { kind: "legacy", upgradeTo: AP_SCHEMA_URL };
  }
  if (schema.startsWith(SPEC_SCHEMA_PREFIX)) return { kind: "unsupported-spec" };
  return { kind: "unknown" };
}

/** True for any identifier that names an Agent Plugins manifest (known, legacy, or another spec version). */
export function isAgentPluginsSchemaId(schema: unknown): boolean {
  if (typeof schema !== "string") return false;
  return lookupApSchema(schema).kind !== "unknown";
}
