import { getHarnesstapDir } from "../db/connection.js";
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

function argvRequestsJson(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "--format=json") {
      return true;
    }
    if (arg === "--format" && argv[i + 1] === "json") {
      return true;
    }
  }
  return false;
}

export function maybeWarnCliTelemetry(
  harnesstapDir = getHarnesstapDir(),
  opts?: { argv?: string[]; stdoutIsTTY?: boolean },
): void {
  try {
    const argv = opts?.argv ?? process.argv;
    const stdoutIsTTY = opts?.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
    const skipForMachineOutput = argvRequestsJson(argv) || !stdoutIsTTY;
    if (skipForMachineOutput && !noticePrinter) {
      return;
    }

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
    (noticePrinter ?? ((text: string) => {
      console.error(text);
    }))(message);
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
