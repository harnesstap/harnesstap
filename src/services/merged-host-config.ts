import { getAllPlatforms } from "../platforms/registry.js";
import type { PlatformPaths } from "../types.js";

export const CLAUDE_SETTINGS_RELATIVE = ".claude/settings.json";
export const CLAUDE_USER_JSON_RELATIVE = ".claude.json";
export const MUSE_SETTINGS_RELATIVE = ".config/muse/settings.json";
export const MINIMAX_MCP_RELATIVE = ".minimax/mcp.json";

const INSTRUCTION_BASENAMES = new Set([
  "claude.md",
  "agents.md",
  "agent.md",
  "gemini.md",
  "amazonq.md",
  "conventions.md",
  "jules.md",
  ".windsurfrules",
  ".cursorrules",
  ".goosehints",
  ".rules",
  "copilot-instructions.md",
]);

const MERGEABLE_FILE_RE =
  /(^|\/)((\.?mcp(-config)?\.json)|mcp_config\.json|hooks\.json|config\.toml|opencode\.json|settings\.json)$/i;

function addPathToSet(paths: Set<string>, raw: string | undefined): void {
  if (!raw) {
    return;
  }
  const normalized = normalizeHostConfigPath(raw);
  if (!normalized || normalized.endsWith("/")) {
    return;
  }
  paths.add(normalized);
}

function collectPathsFromGroup(paths: Set<string>, group: PlatformPaths): void {
  addPathToSet(paths, group.settings);
  addPathToSet(paths, group.mcp);
  addPathToSet(paths, group.hooks);
  addPathToSet(paths, group.permissions);
  addPathToSet(paths, group.instructions);
  addPathToSet(paths, group.legacy_instructions);
  for (const alt of group.pathAlternates?.settings ?? []) {
    addPathToSet(paths, alt);
  }
  for (const alt of group.pathAlternates?.instructions ?? []) {
    addPathToSet(paths, alt);
  }
}

let registryMergeablePaths: Set<string> | undefined;

function registryHostConfigPaths(): Set<string> {
  if (registryMergeablePaths) {
    return registryMergeablePaths;
  }
  const paths = new Set<string>();
  for (const platform of getAllPlatforms()) {
    collectPathsFromGroup(paths, platform.projectPaths);
    collectPathsFromGroup(paths, platform.globalPaths);
  }
  registryMergeablePaths = paths;
  return paths;
}

export function normalizeHostConfigPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^~\//, "");
}

export function isClaudeSettingsPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  return (
    normalized === CLAUDE_SETTINGS_RELATIVE
    || normalized.endsWith(`/${CLAUDE_SETTINGS_RELATIVE}`)
  );
}

export function isClaudeUserJsonPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  return (
    normalized === CLAUDE_USER_JSON_RELATIVE
    || normalized.endsWith(`/${CLAUDE_USER_JSON_RELATIVE}`)
  );
}

export function isMuseSettingsPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  return (
    normalized === MUSE_SETTINGS_RELATIVE
    || normalized.endsWith(`/${MUSE_SETTINGS_RELATIVE}`)
  );
}

export function isMinimaxMcpPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  return (
    normalized === MINIMAX_MCP_RELATIVE
    || normalized.endsWith(`/${MINIMAX_MCP_RELATIVE}`)
  );
}

/**
 * Shared host configs and instruction files that apply merges instead of
 * replacing or deleting. Driven from platform registry settings/mcp/hooks/
 * permissions/instructions paths, plus well-known config and markdown names.
 */
export function isMergeableHostConfigPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  if (
    isClaudeSettingsPath(path)
    || isClaudeUserJsonPath(path)
    || isMuseSettingsPath(path)
    || isMinimaxMcpPath(path)
  ) {
    return true;
  }
  if (MERGEABLE_FILE_RE.test(normalized)) {
    return true;
  }
  const basename = normalized.split("/").pop()?.toLowerCase() ?? "";
  if (INSTRUCTION_BASENAMES.has(basename)) {
    return true;
  }
  const registry = registryHostConfigPaths();
  if (registry.has(normalized)) {
    return true;
  }
  for (const known of registry) {
    if (normalized.endsWith(`/${known}`)) {
      return true;
    }
  }
  return false;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeEnvRecord(
  existing: unknown,
  overlay: unknown,
): Record<string, unknown> {
  const base =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const patch =
    typeof overlay === "object" && overlay !== null && !Array.isArray(overlay)
      ? (overlay as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

/**
 * Overlay profile-managed Claude settings keys onto the live file.
 * Unrelated top-level keys (model, alwaysThinkingEnabled, and similar) are kept.
 * `env` is merged key-wise. `permissions` overlays allow/deny/ask lists and
 * keeps extra live keys such as defaultMode. `hooks` are replaced when present
 * in the generated overlay.
 */
export function mergeClaudeSettingsContent(
  existingRaw: string | null | undefined,
  generatedRaw: string,
): string {
  const generated = parseJsonObject(generatedRaw);
  if (!generated) {
    return generatedRaw;
  }
  if (!existingRaw) {
    return `${JSON.stringify(generated, null, 2)}\n`;
  }
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return `${JSON.stringify(generated, null, 2)}\n`;
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(generated)) {
    if (key === "env") {
      merged.env = mergeEnvRecord(existing.env, value);
      continue;
    }
    if (key === "permissions") {
      merged.permissions = mergeEnvRecord(existing.permissions, value);
      continue;
    }
    merged[key] = value;
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Overlay user-scope `mcpServers` onto live `~/.claude.json`.
 * Preserves OAuth session, `projects` (local-scope MCP and trust state),
 * and every other top-level key. Refuses to replace the file when the live
 * JSON cannot be parsed. Local-scope servers are never written into this overlay.
 */
export function mergeClaudeUserJsonContent(
  existingRaw: string | null | undefined,
  generatedRaw: string,
): string {
  const generated = parseJsonObject(generatedRaw);
  if (!generated) {
    return existingRaw ?? generatedRaw;
  }
  if (!existingRaw) {
    return `${JSON.stringify(generated, null, 2)}\n`;
  }
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return existingRaw;
  }

  const merged: Record<string, unknown> = { ...existing };
  if (generated.mcpServers !== undefined) {
    merged.mcpServers = mergeEnvRecord(existing.mcpServers, generated.mcpServers);
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Overlay Muse user-settings keys onto the live `settings.json`.
 * Always writes `schema_version: 1`. Merges `mcp_servers` key-wise.
 * Replaces `hooks` when present in the overlay. Leaves model defaults, TUI,
 * runtime_capabilities, telemetry, and managed_hooks_path unless overlayed.
 */
export function mergeMuseSettingsContent(
  existingRaw: string | null | undefined,
  generatedRaw: string,
): string {
  const generated = parseJsonObject(generatedRaw);
  if (!generated) {
    return generatedRaw;
  }
  if (!existingRaw) {
    return `${JSON.stringify({ schema_version: 1, ...generated }, null, 2)}\n`;
  }
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return `${JSON.stringify({ schema_version: 1, ...generated }, null, 2)}\n`;
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(generated)) {
    if (key === "mcp_servers") {
      merged.mcp_servers = mergeEnvRecord(existing.mcp_servers, value);
      continue;
    }
    merged[key] = value;
  }
  merged.schema_version = 1;
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Overlay MiniMax `mcpServers` onto live `~/.minimax/mcp.json`.
 * Merges servers key-wise. Leaves unrelated top-level keys.
 */
export function mergeMinimaxMcpContent(
  existingRaw: string | null | undefined,
  generatedRaw: string,
): string {
  const generated = parseJsonObject(generatedRaw);
  if (!generated) {
    return generatedRaw;
  }
  if (!existingRaw) {
    return `${JSON.stringify(generated, null, 2)}\n`;
  }
  const existing = parseJsonObject(existingRaw);
  if (!existing) {
    return `${JSON.stringify(generated, null, 2)}\n`;
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(generated)) {
    if (key === "mcpServers") {
      merged.mcpServers = mergeEnvRecord(existing.mcpServers, value);
      continue;
    }
    merged[key] = value;
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}
