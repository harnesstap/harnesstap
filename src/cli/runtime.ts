import type { Command } from "commander";
import { initializeSchema } from "../db/schema.js";
import { getDb } from "../db/connection.js";
import { listProfileLayersCommand } from "../services/profile-commands.js";
import { CliUsageError } from "../services/cli-errors.js";
import { isPromptCancellationError } from "../services/wizards/shared.js";
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

function rewriteProfileShorthandArgv(argv: string[]): string[] {
  const candidate = argv[2];
  if (!candidate || candidate.startsWith("-")) {
    return argv;
  }

  if (knownTopLevelCommandTokens().has(candidate)) {
    return argv;
  }

  let profileNames: Set<string>;
  try {
    const db = getDb();
    initializeSchema(db);
    profileNames = new Set(
      listProfileLayersCommand().map((profile) => profile.name),
    );
  } catch {
    return argv;
  }

  if (!profileNames.has(candidate)) {
    return argv;
  }

  return [argv[0] ?? "node", argv[1] ?? "harnesstap", "profile", "use", candidate, ...argv.slice(3)];
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
