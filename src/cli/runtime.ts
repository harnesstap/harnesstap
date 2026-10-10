import type { Command } from "commander";
import { initializeSchema } from "../db/schema.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import {
  GLOBAL_DEFAULT_PROFILE_NAME,
  LEGACY_DEFAULT_PROFILE_NAME,
} from "../constants/profile.js";
import { listProfilePluginsCommand } from "../services/profile-commands.js";
import { CliUsageError } from "../services/cli-errors.js";
import { PluginProvenanceError } from "../services/plugin-origin.js";
import { isPromptCancellationError } from "../services/wizards/shared.js";
import { takeSelectorDeprecations } from "../services/resource-selector.js";
import { maybeNotifyCliUpdate } from "../services/self-update.js";
import {
  maybeWarnCliTelemetry,
  setTelemetryProduct,
  trackCliStartup,
} from "../telemetry/index.js";
import { ui } from "../ui/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { CLI_HINTS } from "./messages.js";
import { program } from "./program.js";
import {
  fail,
  failCaught,
  isGroupedCommandFallbackError,
  isVerboseMode,
  resolveInvocationName,
} from "./shared.js";
import { isCommanderError } from "./user-errors.js";

const ROOT_VERSION_FLAGS = new Set(["-V", "--version", "--harnesstap-version"]);
const ROOT_PASSTHROUGH_FLAGS = new Set([
  "-v",
  "--verbose",
  "--no-color",
  "--no-interactive",
]);

export function isRootVersionRequest(argv: string[]): boolean {
  const args = argv.slice(2);
  let sawVersion = false;
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }
    if (ROOT_VERSION_FLAGS.has(arg)) {
      sawVersion = true;
      continue;
    }
    if (ROOT_PASSTHROUGH_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return false;
  }
  return sawVersion;
}

function findContextCommand(argv: string[]): Command | null {
  const args = argv.slice(2);

  let currentCommand: Command = program;

  for (const arg of args) {
    if (arg.startsWith("-")) {
      continue;
    }

    const subCommand = currentCommand.commands.find(
      (cmd) => cmd.name() === arg || cmd.aliases().includes(arg),
    );

    if (subCommand) {
      currentCommand = subCommand;
    } else {
      break;
    }
  }

  return currentCommand !== program ? currentCommand : null;
}

function commandPath(command: Command): string {
  const parts: string[] = [];
  let current: Command | null = command;
  while (current && current.parent) {
    parts.unshift(current.name());
    current = current.parent;
  }
  return parts.join(" ");
}

export function renderCliError(error: unknown, argv: string[] = process.argv): void {
  if (isVerboseMode(argv)) {
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
      return;
    }
    console.error(String(error));
    return;
  }

  if (error instanceof PluginProvenanceError) {
    fail(error.message, { hint: error.hints[0] });
    return;
  }

  if (error instanceof CliUsageError) {
    fail(error.message, {
      hint: error.hints[0],
      exitCode: error.exitCode,
    });
    return;
  }

  const contextCommand = findContextCommand(argv);
  if (isCommanderError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, {
      hint: CLI_HINTS.seeOptions(contextCommand ? commandPath(contextCommand) : ""),
      exitCode:
        error && typeof error === "object" && "exitCode" in error
          ? Number((error as { exitCode?: unknown }).exitCode) || 1
          : 1,
    });
    return;
  }

  failCaught(error);
}

function knownTopLevelCommandTokens(): Set<string> {
  const reserved = new Set<string>();
  for (const command of program.commands) {
    reserved.add(command.name());
    for (const alias of command.aliases()) {
      reserved.add(alias);
    }
  }
  return reserved;
}

function firstPositionalIndex(argv: string[]): number {
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      return i + 1 < argv.length ? i + 1 : -1;
    }
    if (!token || !token.startsWith("-")) {
      return i;
    }
  }
  return -1;
}

function rewriteProfileShorthandArgv(argv: string[]): string[] {
  const index = firstPositionalIndex(argv);
  if (index < 0) {
    return argv;
  }

  const candidate = argv[index];
  if (!candidate || knownTopLevelCommandTokens().has(candidate)) {
    return argv;
  }

  let profileNames: Set<string>;
  try {
    const db = getDb();
    initializeSchema(db);
    profileNames = new Set(
      listProfilePluginsCommand().map((profile) => profile.name),
    );
    if (profileNames.has(GLOBAL_DEFAULT_PROFILE_NAME)) {
      profileNames.add(LEGACY_DEFAULT_PROFILE_NAME);
    }
  } catch {
    return argv;
  }

  if (!profileNames.has(candidate)) {
    return argv;
  }

  return [
    ...argv.slice(0, index),
    "profile",
    "use",
    candidate,
    ...argv.slice(index + 1),
  ];
}

export async function runHarnesstapCli(
  argv: string[] = process.argv,
): Promise<void> {
  program.name(resolveInvocationName());
  process.exitCode = 0;
  if (isRootVersionRequest(argv)) {
    console.log(PACKAGE_VERSION);
    return;
  }
  const positional = argv.slice(2).find((token) => token !== "--" && !token.startsWith("-"));
  if (positional === "uninstall") {
    fail("HarnessTap has no uninstall command.", {
      hint: "Remove the CLI with: npm uninstall -g harnesstap",
    });
    return;
  }
  if (positional === "version") {
    fail("HarnessTap has no version command.", {
      hint: "Print the version with: ht --version",
    });
    return;
  }
  setTelemetryProduct("cli");
  maybeWarnCliTelemetry(getHarnesstapDir(), { argv });
  trackCliStartup();
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  const effectiveArgv = rewriteProfileShorthandArgv(argv);
  try {
    await program.parseAsync(effectiveArgv);
    for (const notice of takeSelectorDeprecations()) {
      ui.warn(notice);
    }
    await maybeNotifyCliUpdate({ argv: effectiveArgv });
  } catch (error) {
    if (isPromptCancellationError(error)) {
      return;
    }

    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (isGroupedCommandFallbackError(error)) {
      const match = error.message.match(/too many arguments for '([^']+)'\. Expected 0 arguments but got \d+\./i);
      const commandName = match?.[1] ?? "command";
      const commandIndex = effectiveArgv.findIndex(
        (value, index) => index >= 2 && value === commandName,
      );
      const attemptedSubcommand =
        commandIndex >= 0 ? effectiveArgv[commandIndex + 1] : undefined;
      error.code = "commander.unknownCommand";
      error.message = attemptedSubcommand
        ? `error: unknown command '${commandName} ${attemptedSubcommand}'`
        : `error: unknown command '${commandName}'`;
      throw error;
    }
    if (
      code === "commander.help"
      || code === "commander.helpDisplayed"
      || code === "commander.version"
    ) {
      return;
    }
    throw error;
  }
}
