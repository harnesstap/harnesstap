export const CLAUDE_SETTINGS_RELATIVE = ".claude/settings.json";
export const MUSE_SETTINGS_RELATIVE = ".config/muse/settings.json";

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

export function isMuseSettingsPath(path: string): boolean {
  const normalized = normalizeHostConfigPath(path);
  return (
    normalized === MUSE_SETTINGS_RELATIVE
    || normalized.endsWith(`/${MUSE_SETTINGS_RELATIVE}`)
  );
}

/**
 * Shared host JSON that apply merges instead of replacing or deleting.
 * Claude `.claude/settings.json` and Muse `~/.config/muse/settings.json` hold
 * profile-managed keys alongside unrelated user settings.
 */
export function isMergeableHostConfigPath(path: string): boolean {
  return isClaudeSettingsPath(path) || isMuseSettingsPath(path);
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
 * Unrelated top-level keys (model, alwaysThinkingEnabled, …) are kept.
 * `env` is merged key-wise; `permissions` and `hooks` are replaced when present
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
    merged[key] = value;
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
