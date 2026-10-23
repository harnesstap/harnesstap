import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

/**
 * The `enabledPlugins` keys of `~/.claude/settings.json` HarnessTap added,
 * kept in `<harnesstap>/cache/claude-enabled-plugins.json`. A key HarnessTap
 * did not add (the user wrote it) is never removed or changed by a switch: the
 * file does not say who wrote a key, so this record does.
 *
 * - A key is recorded when an apply wrote it and the file had no such key.
 * - A recorded key whose entry is gone from the file is forgotten. When a
 *   switch removed it, the forgotten refs are kept per snapshot
 *   (`removed-ownership/<snapshot>.enabled.json`) so a revert that puts the
 *   key back gives it back to HarnessTap too.
 */
interface EnabledKeyRecords {
  version: 1;
  files: Record<string, string[]>;
}

const SETTINGS_RELATIVE_PATH = ".claude/settings.json";

function recordsPath(): string {
  return join(getHarnesstapDir(), "cache", "claude-enabled-plugins.json");
}

function snapshotFile(snapshotId: string): string | undefined {
  if (!/^[0-9A-Za-z_-]+$/.test(snapshotId)) return undefined;
  return join(getHarnesstapDir(), "cache", "removed-ownership", `${snapshotId}.enabled.json`);
}

function readRecords(): EnabledKeyRecords {
  try {
    const parsed = JSON.parse(readFileSync(recordsPath(), "utf8")) as Partial<EnabledKeyRecords>;
    if (parsed.version === 1 && typeof parsed.files === "object" && parsed.files !== null) {
      return { version: 1, files: parsed.files };
    }
  } catch {
    // No record yet: nothing was added by HarnessTap.
  }
  return { version: 1, files: {} };
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // Best effort: an unrecorded key is only ever kept, never removed.
  }
}

function enabledPluginsIn(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const enabled = (JSON.parse(raw) as { enabledPlugins?: unknown }).enabledPlugins;
    return typeof enabled === "object" && enabled !== null && !Array.isArray(enabled)
      ? (enabled as Record<string, unknown>)
      : {};
  } catch {
    return undefined;
  }
}

function readIfExists(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** True for the Claude Code user settings file of `rootPath`, given as a home-relative path. */
export function isClaudeSettingsPath(relativePath: string): boolean {
  return relativePath.replaceAll("\\", "/") === SETTINGS_RELATIVE_PATH;
}

/** True when HarnessTap added the `enabledPlugins` key `ref` to `settingsPath`. */
export function isHarnessTapEnabledKey(settingsPath: string, ref: string): boolean {
  return readRecords().files[resolve(settingsPath)]?.includes(ref) === true;
}

/**
 * After an apply wrote `after` over `before` (what the file held), record the
 * `enabledPlugins` keys it added.
 */
export function recordAddedEnabledKeys(
  settingsPath: string,
  before: string | undefined,
  after: string,
): void {
  const now = enabledPluginsIn(after) ?? {};
  const was = enabledPluginsIn(before) ?? {};
  const added = Object.keys(now).filter((ref) => !(ref in was));
  if (added.length === 0) return;
  const records = readRecords();
  const key = resolve(settingsPath);
  records.files[key] = [...new Set([...(records.files[key] ?? []), ...added])].sort();
  writeJson(recordsPath(), records);
}

/**
 * Forget the recorded keys the file no longer has (a switch removed them, or
 * the user did). With `snapshotId` the forgotten refs are saved for a revert.
 */
export function forgetMissingEnabledKeys(settingsPath: string, snapshotId?: string | null): void {
  const key = resolve(settingsPath);
  const records = readRecords();
  const recorded = records.files[key];
  if (!recorded || recorded.length === 0) return;
  const enabled = enabledPluginsIn(readIfExists(key)) ?? {};
  const gone = recorded.filter((ref) => !(ref in enabled));
  if (gone.length === 0) return;
  const rest = recorded.filter((ref) => ref in enabled);
  if (rest.length === 0) delete records.files[key];
  else records.files[key] = rest;
  writeJson(recordsPath(), records);
  const file = snapshotId ? snapshotFile(snapshotId) : undefined;
  if (!file) return;
  const saved = readSnapshot(file);
  saved[key] = [...new Set([...(saved[key] ?? []), ...gone])].sort();
  writeJson(file, saved);
}

function readSnapshot(file: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

/**
 * After a revert restored `settingsPath`, give HarnessTap back the keys the
 * snapshot's switch removed that the file has again, and drop the records of
 * keys the restored file does not have.
 */
export function restoreForgottenEnabledKeys(settingsPath: string, snapshotId: string): void {
  forgetMissingEnabledKeys(settingsPath);
  const file = snapshotFile(snapshotId);
  const key = resolve(settingsPath);
  const refs = file ? readSnapshot(file)[key] : undefined;
  if (!refs || refs.length === 0) return;
  const enabled = enabledPluginsIn(readIfExists(key)) ?? {};
  const back = refs.filter((ref) => ref in enabled);
  if (back.length === 0) return;
  const records = readRecords();
  records.files[key] = [...new Set([...(records.files[key] ?? []), ...back])].sort();
  writeJson(recordsPath(), records);
}
