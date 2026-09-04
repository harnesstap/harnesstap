export {
  captureEvent,
  identifyCloudUser,
  setTelemetryTransportForTests,
} from "./capture.js";
export {
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_PROJECT_API_KEY,
  isTelemetryEnabled,
  resolvePosthogCaptureUrl,
  resolvePosthogHost,
  resolvePosthogProjectApiKey,
} from "./config.js";
export { detectCliInstallMethod } from "./install-method.js";
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
