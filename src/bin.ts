import { assertSupportedRuntime } from "./node-version.js";
import { isRootHelpRequest, isRootVersionRequest } from "./cli/root-flags.js";

assertSupportedRuntime();

async function runCliEntry(): Promise<void> {
  if (isRootVersionRequest(process.argv)) {
    const { PACKAGE_VERSION } = await import("./version.js");
    console.log(PACKAGE_VERSION);
    return;
  }
  if (isRootHelpRequest(process.argv)) {
    const { printRootHelp } = await import("./cli/help.js");
    printRootHelp(process.argv);
    return;
  }

  const cliEntry = new URL("./index.js", import.meta.url).href;
  const cli: typeof import("./index.js") = await import(cliEntry);
  try {
    await cli.runHarnesstapCli();
  } catch (error: unknown) {
    if (cli.isPromptCancellationError(error)) {
      process.exitCode = 0;
      return;
    }
    process.exitCode =
      error && typeof error === "object" && "exitCode" in error
        ? Number((error as { exitCode?: unknown }).exitCode) || 1
        : 1;
    cli.renderCliError(error);
  }
}

void runCliEntry();
