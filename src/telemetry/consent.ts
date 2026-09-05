import { getHarnesstapDir } from "../db/connection.js";
import { telemetryConsentCopy } from "./copy.js";
import {
  isTelemetryEnabled,
  persistTelemetryPreference,
  readTelemetryConfigPreference,
  telemetryEnvFlag,
} from "./config.js";

export type TelemetryConsentStatus = {
  enabled: boolean;
  consented: boolean;
  preference: boolean | null;
  env_override: boolean | null;
  needs_consent: boolean;
  copy: ReturnType<typeof telemetryConsentCopy>;
};

export function getTelemetryConsentStatus(
  harnesstapDir = getHarnesstapDir(),
): TelemetryConsentStatus {
  const env = telemetryEnvFlag();
  const preference = readTelemetryConfigPreference(harnesstapDir);
  const consented = preference !== undefined;
  const envOverride = env ?? null;
  return {
    enabled: isTelemetryEnabled(harnesstapDir),
    consented,
    preference: preference ?? null,
    env_override: envOverride,
    needs_consent: env === undefined && !consented,
    copy: telemetryConsentCopy(),
  };
}

export function setTelemetryConsent(
  enabled: boolean,
  harnesstapDir = getHarnesstapDir(),
): TelemetryConsentStatus {
  persistTelemetryPreference(enabled, harnesstapDir);
  return getTelemetryConsentStatus(harnesstapDir);
}
