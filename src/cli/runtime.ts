import type { Command } from "commander";
import { initializeSchema } from "../db/schema.js";
import { getDb } from "../db/connection.js";
import {
  GLOBAL_DEFAULT_PROFILE_NAME,
  LEGACY_DEFAULT_PROFILE_NAME,
} from "../constants/profile.js";
import { listProfilePluginsCommand } from "../services/profile-commands.js";
import { CliUsageError } from "../services/cli-errors.js";
import { PluginProvenanceError } from "../services/plugin-origin.js";
import { isPromptCancellationError } from "../services/wizards/shared.js";
import { takeSelectorDeprecations } from "../services/resource-selector.js";
import { ui } from "../ui/index.js";
import { program } from "./program.js";
import {
  isGroupedCommandFallbackError,
  isVerboseMode,
  resolveInvocationName,
} from "./shared.js";

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
    ui.danger(error.message, { hints: error.hints });
    process.exitCode = 1;
    return;
  }

  if (error instanceof CliUsageError) {
    ui.danger(error.message, { hints: error.hints });
  } else {
    const message = error instanceof Error ? error.message : String(error);
    ui.danger(message);
  }

  const contextCommand = findContextCommand(argv);
  if (contextCommand) {
    console.error(`\n${contextCommand.helpInformation()}`);
  }
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
