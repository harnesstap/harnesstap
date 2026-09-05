import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTelemetryEnabled,
  resolvePosthogProjectApiKey,
} from "../../src/telemetry/config.ts";
import { detectCliInstallMethod } from "../../src/telemetry/install-method.ts";

describe("telemetry config", () => {
  const previousTelemetry = process.env.HARNESSTAP_TELEMETRY;
  const previousKey = process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
  const previousMethod = process.env.HARNESSTAP_INSTALL_METHOD;

  afterEach(() => {
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
    if (previousMethod === undefined) {
      delete process.env.HARNESSTAP_INSTALL_METHOD;
    } else {
      process.env.HARNESSTAP_INSTALL_METHOD = previousMethod;
    }
  });

  it("honors HARNESSTAP_TELEMETRY=0", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-tel-cfg-"));
    process.env.HARNESSTAP_TELEMETRY = "0";
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test";
    expect(isTelemetryEnabled(dir)).toBe(false);
  });

  it("honors telemetry.enabled false in config.jsonc", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-tel-cfg-"));
    delete process.env.HARNESSTAP_TELEMETRY;
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test";
    writeFileSync(
      join(dir, "config.jsonc"),
      `${JSON.stringify({ telemetry: { enabled: false } }, null, 2)}\n`,
    );
    expect(isTelemetryEnabled(dir)).toBe(false);
  });

  it("does not capture when telemetry.enabled is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-tel-cfg-"));
    delete process.env.HARNESSTAP_TELEMETRY;
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test";
    expect(isTelemetryEnabled(dir)).toBe(false);
  });

  it("treats an empty project API key override as disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-tel-cfg-"));
    process.env.HARNESSTAP_TELEMETRY = "1";
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "";
    expect(resolvePosthogProjectApiKey()).toBeUndefined();
    expect(isTelemetryEnabled(dir)).toBe(false);
  });

  it("honors HARNESSTAP_INSTALL_METHOD", () => {
    process.env.HARNESSTAP_INSTALL_METHOD = "brew";
    expect(detectCliInstallMethod()).toBe("brew");
  });
});
