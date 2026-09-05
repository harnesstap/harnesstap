import { getHarnesstapDir } from "../db/connection.js";
import { ui } from "../ui/index.js";
import {
  formatCliTelemetryEnabledWarning,
  formatCliTelemetryUnsettledWarning,
} from "./copy.js";
import {
  isTelemetryEnabled,
  readTelemetryConfigPreference,
  telemetryEnvFlag,
} from "./config.js";
import { loadTelemetryState, updateTelemetryState } from "./state.js";

let noticePrinter: ((message: string) => void) | undefined;

export function setTelemetryNoticePrinterForTests(
  printer?: (message: string) => void,
): void {
  noticePrinter = printer;
}

export function maybeWarnCliTelemetry(
  harnesstapDir = getHarnesstapDir(),
): void {
  try {
    const env = telemetryEnvFlag();
    if (env === false) {
      return;
    }
    const preference = readTelemetryConfigPreference(harnesstapDir);
    const enabled = isTelemetryEnabled(harnesstapDir);
    const unsettled = env === undefined && preference === undefined;
    if (!enabled && !unsettled) {
      return;
    }
    const state = loadTelemetryState(harnesstapDir);
    if (state.cli_notice_shown_at) {
      return;
    }
    const message = enabled
      ? formatCliTelemetryEnabledWarning()
      : formatCliTelemetryUnsettledWarning();
    (noticePrinter ?? ((text: string) => ui.warn(text)))(message);
    updateTelemetryState(
      {
        cli_notice_shown_at: new Date().toISOString(),
      },
      harnesstapDir,
    );
  } catch {
    // swallow
  }
}
