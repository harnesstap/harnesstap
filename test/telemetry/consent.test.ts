import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatCliTelemetryEnabledWarning,
  formatCliTelemetryUnsettledWarning,
  getTelemetryConsentStatus,
  isTelemetryEnabled,
  maybeWarnCliTelemetry,
  persistTelemetryPreference,
  setTelemetryNoticePrinterForTests,
  TELEMETRY_CLI_DISABLE_INSTRUCTIONS,
  TELEMETRY_CLI_ENABLE_INSTRUCTIONS,
} from "../../src/telemetry/index.ts";

describe("telemetry consent", () => {
  const previousHome = process.env.HARNESSTAP_HOME;
  const previousTelemetry = process.env.HARNESSTAP_TELEMETRY;
  const previousKey = process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ht-tel-consent-"));
    process.env.HARNESSTAP_HOME = dir;
    process.env.HARNESSTAP_TELEMETRY = "";
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test";
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HARNESSTAP_HOME;
    } else {
      process.env.HARNESSTAP_HOME = previousHome;
    }
    if (previousTelemetry === undefined) {
      delete process.env.HARNESSTAP_TELEMETRY;
    } else {
      process.env.HARNESSTAP_TELEMETRY = previousTelemetry;
    }
    if (previousKey === undefined) {
      delete process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
    } else {
      process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = previousKey;
    }
  });

  it("does not enable capture until a preference is persisted", () => {
    expect(isTelemetryEnabled(dir)).toBe(false);
    const status = getTelemetryConsentStatus(dir);
    expect(status.needs_consent).toBe(true);
    expect(status.consented).toBe(false);
    expect(status.enabled).toBe(false);
  });

  it("persists enable/disable in config.jsonc and does not ask again", () => {
    persistTelemetryPreference(true, dir);
    expect(isTelemetryEnabled(dir)).toBe(true);
    const enabled = getTelemetryConsentStatus(dir);
    expect(enabled.needs_consent).toBe(false);
    expect(enabled.preference).toBe(true);

    persistTelemetryPreference(false, dir);
    expect(isTelemetryEnabled(dir)).toBe(false);
    const disabled = getTelemetryConsentStatus(dir);
    expect(disabled.needs_consent).toBe(false);
    expect(disabled.preference).toBe(false);

    const raw = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8")) as {
      telemetry: { enabled: boolean };
    };
    expect(raw.telemetry.enabled).toBe(false);
  });

  it("lets HARNESSTAP_TELEMETRY=0 override an enabled preference", () => {
    persistTelemetryPreference(true, dir);
    process.env.HARNESSTAP_TELEMETRY = "0";
    expect(isTelemetryEnabled(dir)).toBe(false);
    expect(getTelemetryConsentStatus(dir).needs_consent).toBe(false);
  });

  it("lets HARNESSTAP_TELEMETRY=1 capture before config consent", () => {
    process.env.HARNESSTAP_TELEMETRY = "1";
    expect(isTelemetryEnabled(dir)).toBe(true);
    expect(getTelemetryConsentStatus(dir).needs_consent).toBe(false);
  });

  it("warns once when telemetry is enabled with disable instructions", () => {
    persistTelemetryPreference(true, dir);
    const lines: string[] = [];
    setTelemetryNoticePrinterForTests((message) => {
      lines.push(message);
    });
    try {
      maybeWarnCliTelemetry(dir);
      maybeWarnCliTelemetry(dir);
    } finally {
      setTelemetryNoticePrinterForTests(undefined);
    }
    const output = lines.join("\n");
    expect(output).toContain("Anonymous usage telemetry is on.");
    expect(output).toContain(TELEMETRY_CLI_DISABLE_INSTRUCTIONS);
    expect(output).toContain("HARNESSTAP_TELEMETRY=0");
    expect(output).toContain('"telemetry": { "enabled": false }');
    expect(output).toContain("~/.harnesstap/config.jsonc");
    expect(lines).toHaveLength(1);
    expect(formatCliTelemetryEnabledWarning()).toContain("No personal data");
  });

  it("warns once when consent is unsettled and does not capture", () => {
    const lines: string[] = [];
    setTelemetryNoticePrinterForTests((message) => {
      lines.push(message);
    });
    try {
      maybeWarnCliTelemetry(dir);
    } finally {
      setTelemetryNoticePrinterForTests(undefined);
    }
    const output = lines.join("\n");
    expect(output).toContain("off until you opt in");
    expect(output).toContain(TELEMETRY_CLI_ENABLE_INSTRUCTIONS);
    expect(output).toContain(TELEMETRY_CLI_DISABLE_INSTRUCTIONS);
    expect(formatCliTelemetryUnsettledWarning()).toContain("No resource-related information");
    expect(isTelemetryEnabled(dir)).toBe(false);
  });

  it("does not warn when telemetry is already disabled", () => {
    persistTelemetryPreference(false, dir);
    const lines: string[] = [];
    setTelemetryNoticePrinterForTests((message) => {
      lines.push(message);
    });
    try {
      maybeWarnCliTelemetry(dir);
    } finally {
      setTelemetryNoticePrinterForTests(undefined);
    }
    expect(lines).toHaveLength(0);
  });

  it("preserves other config keys when writing telemetry preference", () => {
    writeFileSync(
      join(dir, "config.jsonc"),
      `${JSON.stringify({ plugins: { refreshMaxAgeHours: 48, marketplaces: [] } }, null, 2)}\n`,
    );
    persistTelemetryPreference(false, dir);
    const raw = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8")) as {
      plugins: { refreshMaxAgeHours: number };
      telemetry: { enabled: boolean };
    };
    expect(raw.plugins.refreshMaxAgeHours).toBe(48);
    expect(raw.telemetry.enabled).toBe(false);
  });
});
