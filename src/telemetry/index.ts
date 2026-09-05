export {
  captureEvent,
  identifyCloudUser,
  setTelemetryTransportForTests,
} from "./capture.js";
export {
  getTelemetryConsentStatus,
  setTelemetryConsent,
} from "./consent.js";
export type { TelemetryConsentStatus } from "./consent.js";
export {
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_PROJECT_API_KEY,
  isTelemetryConsentSettled,
  isTelemetryEnabled,
  persistTelemetryPreference,
  readTelemetryConfigPreference,
  resolvePosthogCaptureUrl,
  resolvePosthogHost,
  resolvePosthogProjectApiKey,
  telemetryEnvFlag,
} from "./config.js";
export {
  formatCliTelemetryEnabledWarning,
  formatCliTelemetryUnsettledWarning,
  formatTelemetryScopeBody,
  TELEMETRY_CLI_DISABLE_INSTRUCTIONS,
  TELEMETRY_CLI_ENABLE_INSTRUCTIONS,
  TELEMETRY_CONSENT_TITLE,
  telemetryConsentCopy,
} from "./copy.js";
export { detectCliInstallMethod } from "./install-method.js";
export { maybeWarnCliTelemetry, setTelemetryNoticePrinterForTests } from "./notice.js";
export {
  resetTelemetryProductForTests,
  resolveTelemetryProduct,
  setTelemetryProduct,
} from "./product.js";
export { extractCloudUserId, shortReason } from "./sanitize.js";
export {
  loadTelemetryState,
  resolveDistinctId,
  updateTelemetryState,
} from "./state.js";
export {
  identifyFromCloudWhoami,
  trackCliStartup,
  trackCloudConnectFailed,
  trackCloudConnectStarted,
  trackCloudConnected,
  trackDesktopStartup,
  trackPluginApplied,
  trackPluginInstalled,
  trackPluginUsed,
} from "./track.js";
export type {
  PluginInstallSource,
  TelemetryEventName,
  TelemetryProduct,
  TelemetryProps,
  TelemetryTransport,
} from "./types.js";
