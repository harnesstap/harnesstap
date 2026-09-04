import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureEvent,
  extractCloudUserId,
  identifyCloudUser,
  isTelemetryEnabled,
  resetTelemetryProductForTests,
  setTelemetryProduct,
  setTelemetryTransportForTests,
  trackCliStartup,
  trackCloudConnectFailed,
  trackCloudConnected,
  trackPluginApplied,
  trackPluginInstalled,
  trackPluginUsed,
  type TelemetryTransport,
} from "../../src/telemetry/index.ts";
import { PACKAGE_VERSION } from "../../src/version.ts";

function recordedTransport(): { sends: Array<{ url: string; body: Record<string, unknown> }>; transport: TelemetryTransport } {
  const sends: Array<{ url: string; body: Record<string, unknown> }> = [];
  return {
    sends,
    transport: {
      send(url, body) {
        sends.push({ url, body: JSON.parse(body) as Record<string, unknown> });
      },
    },
  };
}

describe("telemetry capture helper", () => {
  let previousHome: string | undefined;
  let previousTelemetry: string | undefined;
  let previousKey: string | undefined;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ht-telemetry-"));
    previousHome = process.env.HARNESSTAP_HOME;
    previousTelemetry = process.env.HARNESSTAP_TELEMETRY;
    previousKey = process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY;
    process.env.HARNESSTAP_HOME = dir;
    process.env.HARNESSTAP_TELEMETRY = "1";
    process.env.HARNESSTAP_POSTHOG_PROJECT_API_KEY = "phc_test_key";
    setTelemetryProduct("cli");
  });

  afterEach(() => {
    setTelemetryTransportForTests(undefined);
    resetTelemetryProductForTests();
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

  it("captures expected event names with product, app_version, and os", () => {
    const { sends, transport } = recordedTransport();
    setTelemetryTransportForTests(transport);

    captureEvent("cli_first_run", { version: PACKAGE_VERSION });

    expect(sends).toHaveLength(1);
    const payload = sends[0]?.body;
    expect(payload?.event).toBe("cli_first_run");
    expect(payload?.api_key).toBe("phc_test_key");
    expect(typeof payload?.distinct_id).toBe("string");
    const properties = payload?.properties as Record<string, unknown>;
    expect(properties.product).toBe("cli");
    expect(properties.app_version).toBe(PACKAGE_VERSION);
    expect(properties.os).toBe(process.platform);
    expect(properties.version).toBe(PACKAGE_VERSION);
  });

  it("emits core-loop names from track helpers", () => {
    const { sends, transport } = recordedTransport();
    setTelemetryTransportForTests(transport);

    trackCliStartup();
    trackCloudConnected({ orgId: "org_1", userId: "user_1" });
    trackCloudConnectFailed("denied", "access_denied");
    trackPluginInstalled({ pluginSlug: "engineering-foundation", source: "catalog" });
    trackPluginApplied({ pluginSlug: "engineering-foundation", harness: "cursor" });
    trackPluginUsed({ pluginSlug: "engineering-foundation", harness: "cursor" });

    const names = sends.map((row) => row.body.event);
    expect(names).toContain("cli_installed");
    expect(names).toContain("cli_first_run");
    expect(names).toContain("cloud_connected");
    expect(names).toContain("signed_in");
    expect(names).toContain("$identify");
    expect(names).toContain("$create_alias");
    expect(names).toContain("cloud_connect_failed");
    expect(names).toContain("plugin_installed");
    expect(names).toContain("plugin_applied");
    expect(names).toContain("plugin_used");
    expect(names).not.toContain("library_created");
  });

  it("does not throw when the transport fails", () => {
    setTelemetryTransportForTests({
      send() {
        throw new Error("network down");
      },
    });
    expect(() => captureEvent("desktop_opened", { version: "1.0.0" })).not.toThrow();
    expect(() => identifyCloudUser("user_1", "anon_1")).not.toThrow();
    expect(() => trackCloudConnectFailed("boom")).not.toThrow();
  });

  it("skips capture when telemetry is disabled", () => {
    process.env.HARNESSTAP_TELEMETRY = "0";
    const { sends, transport } = recordedTransport();
    setTelemetryTransportForTests(transport);
    expect(isTelemetryEnabled()).toBe(false);
    captureEvent("cli_first_run", { version: "1.0.0" });
    expect(sends).toHaveLength(0);
  });

  it("does not put emails into identify payloads", () => {
    expect(extractCloudUserId({ user: { id: "usr_1", email: "a@b.com" } })).toBe("usr_1");
    expect(extractCloudUserId({ user: { email: "a@b.com" } })).toBeUndefined();
    const { sends, transport } = recordedTransport();
    setTelemetryTransportForTests(transport);
    captureEvent("signed_in", { email: "a@b.com", org_id: "org_1" });
    const properties = sends[0]?.body.properties as Record<string, unknown>;
    expect(properties.email).toBeUndefined();
    expect(properties.org_id).toBe("org_1");
  });
});
