import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

/**
 * The `extraKnownMarketplaces` entries of `~/.claude/settings.json` HarnessTap
 * added, kept in `<harnesstap>/cache/claude-settings-marketplaces.json` with a
 * hash of each entry as written. An entry the user wrote, or one the user
 * changed since, is never removed by a switch: the file does not say who wrote
 * an entry, so this record does. Same rules as the `enabledPlugins` keys
 * (`claude-enabled-plugin-keys.ts`):
 *
 * - An entry is recorded when an apply wrote it and the file had no such entry.
 * - A recorded entry that is gone from the file is forgotten. When a switch
 *   removed it, it is kept per snapshot
 *   (`removed-ownership/<snapshot>.marketplaces.json`) so a revert that puts
 *   the entry back gives it back to HarnessTap too.
 */
type EntryHashes = Record<string, string>;

interface MarketplaceRecords {
  version: 1;
  files: Record<string, EntryHashes>;
}

function recordsPath(): string {
  return join(getHarnesstapDir(), "cache", "claude-settings-marketplaces.json");
}

function snapshotFile(snapshotId: string): string | undefined {
  if (!/^[0-9A-Za-z_-]+$/.test(snapshotId)) return undefined;
  return join(getHarnesstapDir(), "cache", "removed-ownership", `${snapshotId}.marketplaces.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function readRecords(): MarketplaceRecords {
  const parsed = readJson(recordsPath());
  if (isRecord(parsed) && parsed.version === 1 && isRecord(parsed.files)) {
    return { version: 1, files: parsed.files as Record<string, EntryHashes> };
  }
  return { version: 1, files: {} };
}

function writeJson(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // Best effort: an unrecorded entry is only ever kept, never removed.
  }
}

function entryHash(entry: unknown): string {
  return createHash("sha256").update(JSON.stringify(entry) ?? "").digest("hex");
}

function entriesIn(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { extraKnownMarketplaces?: unknown };
    return isRecord(parsed.extraKnownMarketplaces) ? parsed.extraKnownMarketplaces : {};
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

/** True when HarnessTap added the entry `name` to `settingsPath` and `entry` is still what it wrote. */
export function isHarnessTapSettingsMarketplace(settingsPath: string, name: string, entry: unknown): boolean {
  const hash = readRecords().files[resolve(settingsPath)]?.[name];
  return hash !== undefined && hash === entryHash(entry);
}

/** After an apply wrote `after` over `before`, record the entries it added. */
export function recordAddedSettingsMarketplaces(
  settingsPath: string,
  before: string | undefined,
  after: string,
): void {
  const now = entriesIn(after) ?? {};
  const was = entriesIn(before) ?? {};
  const added = Object.keys(now).filter((name) => !(name in was));
  if (added.length === 0) return;
  const records = readRecords();
  const key = resolve(settingsPath);
  const next = { ...(records.files[key] ?? {}) };
  for (const name of added) next[name] = entryHash(now[name]);
  records.files[key] = next;
  writeJson(recordsPath(), records);
}

/**
 * Forget the recorded entries the file no longer has with the same value (a
 * switch removed them, or the user did or changed them). With `snapshotId` the
 * ones removed are saved for a revert.
 */
export function forgetMissingSettingsMarketplaces(settingsPath: string, snapshotId?: string | null): void {
  const key = resolve(settingsPath);
  const records = readRecords();
  const recorded = records.files[key];
  if (!recorded || Object.keys(recorded).length === 0) return;
  const now = entriesIn(readIfExists(key)) ?? {};
  const gone = Object.entries(recorded).filter(([name]) => !(name in now));
  const stale = Object.entries(recorded).filter(([name]) => name in now && entryHash(now[name]) !== recorded[name]);
  if (gone.length === 0 && stale.length === 0) return;
  const drop = new Set([...gone, ...stale].map(([name]) => name));
  const rest = Object.fromEntries(Object.entries(recorded).filter(([name]) => !drop.has(name)));
  if (Object.keys(rest).length === 0) delete records.files[key];
  else records.files[key] = rest;
  writeJson(recordsPath(), records);
  const file = snapshotId ? snapshotFile(snapshotId) : undefined;
  if (!file || gone.length === 0) return;
  const parsed = readJson(file);
  const saved = isRecord(parsed) ? (parsed as Record<string, EntryHashes>) : {};
  saved[key] = { ...(saved[key] ?? {}), ...Object.fromEntries(gone) };
  writeJson(file, saved);
}

/**
 * After a revert restored `settingsPath`, give HarnessTap back the entries the
 * snapshot's switch removed that the file has again with the same value.
 */
export function restoreForgottenSettingsMarketplaces(settingsPath: string, snapshotId: string): void {
  forgetMissingSettingsMarketplaces(settingsPath);
  const file = snapshotFile(snapshotId);
  const key = resolve(settingsPath);
  const parsed = file ? readJson(file) : undefined;
  const saved = isRecord(parsed) && isRecord(parsed[key]) ? (parsed[key] as EntryHashes) : undefined;
  if (!saved) return;
  const now = entriesIn(readIfExists(key)) ?? {};
  const back = Object.entries(saved).filter(([name, hash]) => name in now && entryHash(now[name]) === hash);
  if (back.length === 0) return;
  const records = readRecords();
  records.files[key] = { ...(records.files[key] ?? {}), ...Object.fromEntries(back) };
  writeJson(recordsPath(), records);
}
