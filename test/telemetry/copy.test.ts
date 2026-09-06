import { describe, expect, it } from "bun:test";
import {
  formatCliTelemetryUnsettledWarning,
  formatTelemetryScopeBody,
  TELEMETRY_NOT_TRACKED_LINES,
  TELEMETRY_SCOPE_SUMMARY,
  TELEMETRY_TRACKED_LINES,
  telemetryConsentCopy,
} from "../../src/telemetry/copy.ts";

describe("telemetry consent copy", () => {
  it("stays high-level without event-name or Cloud-connect dumps", () => {
    const copy = telemetryConsentCopy();
    const joined = [copy.body, ...copy.tracked, ...copy.not_tracked].join("\n");
    expect(copy.body).toBe(TELEMETRY_SCOPE_SUMMARY);
    expect(copy.tracked).toEqual([...TELEMETRY_TRACKED_LINES]);
    expect(copy.not_tracked).toEqual([...TELEMETRY_NOT_TRACKED_LINES]);
    expect(joined).toContain("HarnessTap Cloud interactions");
    expect(joined).toContain("Plugin install, apply, and view occurences");
    expect(joined).toContain("No personal data");
    expect(joined).toContain("No resource-related information");
    expect(joined).not.toContain("install, first run, Cloud connect");
    expect(joined).not.toContain("error code");
    expect(joined).not.toContain("cloud_connect");
    expect(joined).not.toContain("plugin_slug");
    expect(joined).not.toContain("org_id");
    expect(joined).not.toContain("$identify");
  });

  it("formats CLI warnings as bullet lists", () => {
    const body = formatTelemetryScopeBody();
    expect(body).toContain("What we track:");
    expect(body).toContain("• HarnessTap Cloud interactions");
    expect(body).toContain("• No personal data");
    expect(formatCliTelemetryUnsettledWarning()).toContain(body);
  });
});
