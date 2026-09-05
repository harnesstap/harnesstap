/** User-facing telemetry consent copy. Must match capture in `track.ts` / `capture.ts`. */

export const TELEMETRY_CONSENT_TITLE = "Usage telemetry";

export const TELEMETRY_SCOPE_SUMMARY =
  "HarnessTap can send anonymous product analytics to our EU PostHog project so we can see install, first run, Cloud connect, and plugin install/apply/view counts.";

export const TELEMETRY_TRACKED_LINES = [
  "Which product you used (CLI or Desktop), app version, and operating system",
  "Install method for the CLI (for example brew, npm, or unknown)",
  "Cloud connect started, succeeded, or failed (short error code/reason only)",
  "That a plugin was installed, applied, or viewed, plus source (catalog, local, or URL) and harness name when known",
] as const;

export const TELEMETRY_NOT_TRACKED_LINES = [
  "No personal data: no names, emails, file paths, code, secrets, tokens, or MCP configs",
  "No resource-related information: no plugin names, plugin contents, or organization ids",
] as const;

export const TELEMETRY_CLI_DISABLE_INSTRUCTIONS =
  'Disable with HARNESSTAP_TELEMETRY=0 or set "telemetry": { "enabled": false } in ~/.harnesstap/config.jsonc.';

export const TELEMETRY_CLI_ENABLE_INSTRUCTIONS =
  'Enable with HARNESSTAP_TELEMETRY=1 or set "telemetry": { "enabled": true } in ~/.harnesstap/config.jsonc.';

export function formatTelemetryScopeBody(): string {
  return [
    TELEMETRY_SCOPE_SUMMARY,
    "",
    "What we track:",
    ...TELEMETRY_TRACKED_LINES.map((line) => `• ${line}`),
    "",
    "What we do not track:",
    ...TELEMETRY_NOT_TRACKED_LINES.map((line) => `• ${line}`),
  ].join("\n");
}

export function formatCliTelemetryEnabledWarning(): string {
  return [
    "Anonymous usage telemetry is on.",
    formatTelemetryScopeBody(),
    TELEMETRY_CLI_DISABLE_INSTRUCTIONS,
  ].join("\n");
}

export function formatCliTelemetryUnsettledWarning(): string {
  return [
    "Anonymous usage telemetry is off until you opt in. No events are sent yet.",
    formatTelemetryScopeBody(),
    TELEMETRY_CLI_ENABLE_INSTRUCTIONS,
    TELEMETRY_CLI_DISABLE_INSTRUCTIONS,
  ].join("\n");
}

export function telemetryConsentCopy(): {
  title: string;
  body: string;
  tracked: string[];
  not_tracked: string[];
} {
  return {
    title: TELEMETRY_CONSENT_TITLE,
    body: TELEMETRY_SCOPE_SUMMARY,
    tracked: [...TELEMETRY_TRACKED_LINES],
    not_tracked: [...TELEMETRY_NOT_TRACKED_LINES],
  };
}
