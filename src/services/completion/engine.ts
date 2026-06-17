import { existsSync } from "node:fs";
import type { Command, Option } from "commander";
import { getHarnessdeckDir } from "../../db/connection.js";
import { lookupProviders } from "./registry.js";
import type {
  CompletionCandidate,
  CompletionContext,
} from "./types.js";
import { normalizeFlagName } from "./utils.js";

const INVOCATION_NAMES = new Set(["hd", "harnessdeck"]);

const GLOBAL_FLAG_NAMES = [
  "-v",
  "--verbose",
  "--no-color",
  "--no-interactive",
  "-h",
  "--help",
  "--format",
  "--harness",
];

export function tokenizeCompletionLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const character of line) {
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === " " || character === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function stripInvocationName(tokens: string[]): string[] {
  const first = tokens[0];
  if (first && INVOCATION_NAMES.has(first)) {
    return tokens.slice(1);
  }
  return tokens;
}

function isHiddenCommand(command: Command): boolean {
  return (command.description() as unknown) === false;
}

function getVisibleSubcommands(command: Command): Command[] {
  return command.commands.filter(
    (subcommand) => subcommand.name() && !isHiddenCommand(subcommand),
  );
}

function findSubcommand(parent: Command, token: string): Command | undefined {
  return parent.commands.find(
    (subcommand) =>
      subcommand.name() === token || subcommand.aliases().includes(token),
  );
}

function collectOptions(command: Command): Option[] {
  const options: Option[] = [];
  let current: Command | null = command;
  while (current) {
    options.push(...current.options.filter((option) => !option.hidden));
    current = current.parent;
  }
  return options;
}

function optionTakesValue(option: Option): boolean {
  return Boolean(option.attributeName());
}

function findOption(command: Command, token: string): Option | undefined {
  const normalized = normalizeFlagName(token);
  return collectOptions(command).find((option) => {
    const flags = option.flags.split(/[ ,|]+/).filter(Boolean);
    return flags.some((flag) => {
      const flagName = normalizeFlagName(flag);
      return (
        flag === token
        || flag.startsWith(`${token}=`)
        || flagName === normalized
        || flag === `-${normalized}`
        || flag === `--${normalized}`
      );
    });
  });
}

function optionFlagNames(option: Option): string[] {
  return option.flags
    .split(/[ ,|]+/)
    .filter((flag) => flag.startsWith("-"))
    .map((flag) => flag.replace(/=<.*>$/, ""));
}

interface WalkResult {
  command: Command;
  commandPath: string[];
  positionalIndex: number;
}

function walkConsumedTokens(command: Command, tokens: string[]): WalkResult {
  let currentCommand = command;
  const commandPath: string[] = [];
  let positionalIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (token.startsWith("-")) {
      const option = findOption(currentCommand, token);
      if (option && optionTakesValue(option)) {
        const next = tokens[index + 1];
        if (next && !next.startsWith("-")) {
          index += 1;
        }
      }
      continue;
    }

    const subcommand = findSubcommand(currentCommand, token);
    if (subcommand && !isHiddenCommand(subcommand)) {
      currentCommand = subcommand;
      commandPath.push(subcommand.name());
      positionalIndex = 0;
      continue;
    }

    positionalIndex += 1;
  }

  return {
    command: currentCommand,
    commandPath,
    positionalIndex,
  };
}

function subcommandMatchesPrefix(command: Command, prefix: string): boolean {
  const normalized = prefix.toLowerCase();
  return getVisibleSubcommands(command).some((subcommand) => {
    const names = [subcommand.name(), ...subcommand.aliases()];
    return names.some((name) => name.toLowerCase().startsWith(normalized));
  });
}

function resolveSlot(
  command: Command,
  positionalIndex: number,
  consumed: string[],
  prefix: string,
  endsWithSpace: boolean,
): Pick<CompletionContext, "slot" | "flag" | "positionalIndex"> {
  if (prefix.startsWith("-")) {
    return { slot: "flag", positionalIndex };
  }

  const lastConsumed = consumed[consumed.length - 1];
  if (lastConsumed?.startsWith("-")) {
    const option = findOption(command, lastConsumed);
    if (option && optionTakesValue(option)) {
      return {
        slot: "flag-value",
        flag: normalizeFlagName(lastConsumed),
        positionalIndex,
      };
    }
  }

  const visibleSubcommands = getVisibleSubcommands(command);
  if (
    visibleSubcommands.length > 0
    && (prefix === "" ? endsWithSpace : subcommandMatchesPrefix(command, prefix))
  ) {
    return { slot: "subcommand", positionalIndex };
  }

  return { slot: "positional", positionalIndex };
}

export function parseCompletionContext(
  program: Command,
  line: string,
): CompletionContext {
  const endsWithSpace = /[ \t]$/.test(line);
  const tokens = stripInvocationName(tokenizeCompletionLine(line.trimStart()));
  const consumed = endsWithSpace ? tokens : tokens.slice(0, -1);
  const prefix = endsWithSpace ? "" : (tokens[tokens.length - 1] ?? "");
  const walked = walkConsumedTokens(program, consumed);
  const slotInfo = resolveSlot(
    walked.command,
    walked.positionalIndex,
    consumed,
    prefix,
    endsWithSpace,
  );

  return {
    commandPath: walked.commandPath,
    prefix,
    localDataAvailable: existsSync(getHarnessdeckDir()),
    ...slotInfo,
  };
}

function completeFlags(command: Command, prefix: string): CompletionCandidate[] {
  const normalized = prefix.toLowerCase();
  const seen = new Set<string>();
  const candidates: CompletionCandidate[] = [];

  for (const option of collectOptions(command)) {
    for (const flag of optionFlagNames(option)) {
      if (!flag.toLowerCase().startsWith(normalized) || seen.has(flag)) {
        continue;
      }
      seen.add(flag);
      candidates.push({
        value: flag,
        description: option.description,
      });
    }
  }

  for (const flag of GLOBAL_FLAG_NAMES) {
    if (!flag.toLowerCase().startsWith(normalized) || seen.has(flag)) {
      continue;
    }
    seen.add(flag);
    candidates.push({ value: flag });
  }

  return candidates.sort((left, right) => left.value.localeCompare(right.value));
}

function completeSubcommands(command: Command, prefix: string): CompletionCandidate[] {
  const normalized = prefix.toLowerCase();
  const candidates: CompletionCandidate[] = [];

  for (const subcommand of getVisibleSubcommands(command)) {
    const names = [subcommand.name(), ...subcommand.aliases()];
    for (const name of names) {
      if (!name.toLowerCase().startsWith(normalized)) {
        continue;
      }
      candidates.push({
        value: name,
        description: subcommand.description(),
      });
    }
  }

  return candidates.sort((left, right) => left.value.localeCompare(right.value));
}

async function runProviders(
  providers: ReturnType<typeof lookupProviders>,
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const seen = new Set<string>();
  const merged: CompletionCandidate[] = [];

  for (const provider of providers) {
    const results = await provider(ctx);
    for (const candidate of results) {
      if (seen.has(candidate.value)) {
        continue;
      }
      seen.add(candidate.value);
      merged.push(candidate);
    }
  }

  return merged.sort((left, right) => left.value.localeCompare(right.value));
}

function resolveCommandAtPath(program: Command, commandPath: string[]): Command {
  let current = program;
  for (const segment of commandPath) {
    const next = findSubcommand(current, segment);
    if (!next) {
      break;
    }
    current = next;
  }
  return current;
}

export async function resolveCompletions(
  program: Command,
  ctx: CompletionContext,
): Promise<CompletionCandidate[]> {
  const command = resolveCommandAtPath(program, ctx.commandPath);

  switch (ctx.slot) {
    case "flag":
      return completeFlags(command, ctx.prefix);
    case "subcommand":
      return completeSubcommands(command, ctx.prefix);
    case "flag-value":
      return runProviders(lookupProviders(ctx), ctx);
    case "positional":
      if (!ctx.localDataAvailable) {
        return [];
      }
      return runProviders(lookupProviders(ctx), ctx);
    default: {
      const unexpected: never = ctx.slot;
      return unexpected;
    }
  }
}

export async function completeLine(
  program: Command,
  line: string,
): Promise<CompletionCandidate[]> {
  try {
    const context = parseCompletionContext(program, line);
    return await resolveCompletions(program, context);
  } catch {
    return [];
  }
}

export function collectCommandPaths(
  command: Command,
  prefix: string[] = [],
): string[] {
  const name = command.name();
  const path = name === "harnessdeck" || name === "hd" ? prefix : [...prefix, name];
  const paths: string[] = [];

  if (path.length > 0) {
    paths.push(path.join(" "));
  }

  for (const subcommand of command.commands) {
    if (!subcommand.name() || isHiddenCommand(subcommand)) {
      continue;
    }
    paths.push(...collectCommandPaths(subcommand, path));
  }

  return paths;
}
