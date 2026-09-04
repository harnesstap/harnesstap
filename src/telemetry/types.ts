export const TELEMETRY_PRODUCTS = ["cli", "desktop"] as const;
export type TelemetryProduct = (typeof TELEMETRY_PRODUCTS)[number];

export const TELEMETRY_EVENTS = [
  "cli_installed",
  "cli_first_run",
  "desktop_installed",
  "desktop_opened",
  "desktop_first_open",
  "cloud_connect_started",
  "cloud_connected",
  "cloud_connect_failed",
  "signed_in",
  "signed_up",
  "plugin_installed",
  "plugin_applied",
  "plugin_used",
  "harness_run_started",
  "harness_run_completed",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export type PluginInstallSource = "catalog" | "local" | "url";

export type TelemetryProps = Record<string, string | number | boolean | null>;

export interface TelemetryCapturePayload {
  api_key: string;
  event: string;
  distinct_id: string;
  properties: TelemetryProps;
}

export interface TelemetryTransport {
  send(url: string, body: string): void;
}
