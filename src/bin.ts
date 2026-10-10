import { isNativeModuleMismatch, reportNativeModuleMismatch } from "./db/native-module.js";
import { assertSupportedRuntime } from "./node-version.js";

assertSupportedRuntime();

const cliEntry = new URL("./index.js", import.meta.url).href;

void import(cliEntry).then(
  (cli: typeof import("./index.js")) =>
    cli.runHarnesstapCli().catch((error: unknown) => {
      if (isNativeModuleMismatch(error)) {
        reportNativeModuleMismatch(error);
      }
      if (cli.isPromptCancellationError(error)) {
        process.exitCode = 0;
        return;
      }
      process.exitCode =
        error && typeof error === "object" && "exitCode" in error
          ? Number((error as { exitCode?: unknown }).exitCode) || 1
          : 1;
      cli.renderCliError(error);
    }),
).catch((error: unknown) => {
  if (isNativeModuleMismatch(error)) {
    reportNativeModuleMismatch(error);
  }
  throw error;
});
