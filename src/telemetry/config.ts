import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import {
  parseJsonc,
  readToolkitConfigRecord,
  writeToolkitConfigRecord,
} from "../config/settings.js";

/**
 * Public PostHog project API key for EU project 190845 (client-safe `phc_` key).
 * Override with `HARNESSTAP_POSTHOG_PROJECT_API_KEY`. An empty override disables capture.
 */
export const DEFAULT_POSTHOG_PROJECT_API_KEY =
  "phc_qNGtvTMWscMjjt9yVoK2kySDnpCyMSNb4nNkkXabRtYv";

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

const FALSEY = new Set(["0", "false", "no", "off"]);
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function telemetryEnvFlag(name = "HARNESSTAP_TELEMETRY"): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (FALSEY.has(raw)) {
    return false;
  }
  if (TRUTHY.has(raw)) {
    return true;
  }
  return undefined;
}

export function telemetryConfigPath(harnesstapDir: string): string {
  const jsoncPath = join(harnesstapDir, "config.jsonc");
  const jsonPath = join(harnesstapDir, "config.json");
  if (existsSync(jsoncPath) || !existsSync(jsonPath)) {
    return jsoncPath;
  }
  return jsonPath;
}

export function readTelemetryConfigPreference(
  harnesstapDir: string,
): boolean | undefined {
  const path = telemetryConfigPath(harnesstapDir);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = parseJsonc(readFileSync(path, "utf-8")) as {
      telemetry?: { enabled?: unknown };
    };
    if (typeof raw.telemetry?.enabled === "boolean") {
      return raw.telemetry.enabled;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function persistTelemetryPreference(
  enabled: boolean,
  harnesstapDir = getHarnesstapDir(),
): void {
  const path = telemetryConfigPath(harnesstapDir);
  const existing = readToolkitConfigRecord(harnesstapDir, path);
  const previous =
    existing.telemetry && typeof existing.telemetry === "object"
      ? (existing.telemetry as Record<string, unknown>)
      : {};
  writeToolkitConfigRecord(
    harnesstapDir,
    {
      ...existing,
      telemetry: {
        ...previous,
        enabled,
      },
    },
    path,
  );
}

export function isTelemetryConsentSettled(
  harnesstapDir = getHarnesstapDir(),
): boolean {
  return (
    telemetryEnvFlag() !== undefined
    || readTelemetryConfigPreference(harnesstapDir) !== undefined
  );
}

export function isTelemetryEnabled(harnesstapDir = getHarnesstapDir()): boolean {
  const env = telemetryEnvFlag();
  if (env === false) {
    return false;
  }
  if (env === true) {
    return Boolean(resolvePosthogProjectApiKey());
  }
  const preference = readTelemetryConfigPreference(harnesstapDir);
  if (preference !== true) {
    return false;
  }
  return Boolean(resolvePosthogProjectApiKey());
}

export function resolvePosthogProjectApiKey(): string | undefined {
  if (Object.hasOwn(process.env, "HARNESSTAP_POSTHOG_PROJECT_API_KEY")) {
    const override = process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY?.trim();
    return override && override.length > 0 ? override : undefined;
  }
  return DEFAULT_POSTHOG_PROJECT_API_KEY;
}

export function resolvePosthogHost(): string {
  const override = process.env.HARNESSTAP_POSTHOG_HOST?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }
  return DEFAULT_POSTHOG_HOST;
}

export function resolvePosthogCaptureUrl(): string {
  return `${resolvePosthogHost()}/capture/`;
}
