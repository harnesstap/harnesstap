import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

export interface TelemetryStateFile {
  distinct_id: string;
  identified_distinct_id?: string;
  cli_installed_at?: string;
  cli_first_run_at?: string;
  desktop_installed_at?: string;
  desktop_first_open_at?: string;
}

function statePath(harnesstapDir: string): string {
  return join(harnesstapDir, "telemetry-state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function loadTelemetryState(
  harnesstapDir = getHarnesstapDir(),
): TelemetryStateFile {
  const path = statePath(harnesstapDir);
  if (!existsSync(path)) {
    return { distinct_id: randomUUID() };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isRecord(parsed)) {
      return { distinct_id: randomUUID() };
    }
    return {
      distinct_id: stringField(parsed.distinct_id) ?? randomUUID(),
      ...(stringField(parsed.identified_distinct_id)
        ? { identified_distinct_id: stringField(parsed.identified_distinct_id) }
        : {}),
      ...(stringField(parsed.cli_installed_at)
        ? { cli_installed_at: stringField(parsed.cli_installed_at) }
        : {}),
      ...(stringField(parsed.cli_first_run_at)
        ? { cli_first_run_at: stringField(parsed.cli_first_run_at) }
        : {}),
      ...(stringField(parsed.desktop_installed_at)
        ? { desktop_installed_at: stringField(parsed.desktop_installed_at) }
        : {}),
      ...(stringField(parsed.desktop_first_open_at)
        ? { desktop_first_open_at: stringField(parsed.desktop_first_open_at) }
        : {}),
    };
  } catch {
    return { distinct_id: randomUUID() };
  }
}

export function saveTelemetryState(
  state: TelemetryStateFile,
  harnesstapDir = getHarnesstapDir(),
): void {
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(statePath(harnesstapDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function updateTelemetryState(
  patch: Partial<TelemetryStateFile>,
  harnesstapDir = getHarnesstapDir(),
): TelemetryStateFile {
  const current = loadTelemetryState(harnesstapDir);
  const next: TelemetryStateFile = { ...current, ...patch };
  saveTelemetryState(next, harnesstapDir);
  return next;
}

export function resolveDistinctId(harnesstapDir = getHarnesstapDir()): string {
  const current = loadTelemetryState(harnesstapDir);
  if (current.identified_distinct_id) {
    return current.identified_distinct_id;
  }
  saveTelemetryState(current, harnesstapDir);
  return current.distinct_id;
}
