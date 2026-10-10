import { basename } from "node:path";
import { CliUsageError } from "../services/cli-errors.js";
import { ensureErrorPrefix } from "./messages.js";
import { isCommanderError, mapUserFacingError } from "./user-errors.js";

export const GUIDE_SCENARIOS_URL =
  "https://github.com/harnesstap/harnesstap/blob/main/docs/scenarios/scenarios.md";

export const GIT_ORIGIN_HINTS = [
  "Add a remote: git remote add origin <url>",
  "Snapshots, drift, history, and revert require a git repository with origin configured.",
];

export function resolveInvocationName(): "harnesstap" | "ht" {
  return basename(process.argv[1] ?? "") === "ht" ? "ht" : "harnesstap";
}

/** DS-6: hints and follow-up commands always say `ht`. */
export function formatCommand(path: string): string {
  const trimmed = path.trim();
  const stripped = trimmed.replace(/^(?:harnesstap|ht)\s+/, "");
  return stripped.length > 0 ? `ht ${stripped}` : "ht";
}

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export function formatHintCommand(args: string[]): string {
  return ["ht", ...args.map(shellQuote)].join(" ");
}

export function fail(
  message: string,
  opts?: { hint?: string; hints?: string[]; exitCode?: number },
): void {
  process.exitCode = opts?.exitCode ?? 1;
  console.error(ensureErrorPrefix(message));
  const hints = opts?.hints ?? (opts?.hint ? [opts.hint] : []);
  for (const hint of hints) {
    if (hint.trim().length > 0) {
      console.error(hint);
    }
  }
}

export function failCaught(error: unknown, opts?: { exitCode?: number }): void {
  if (error instanceof CliUsageError) {
    fail(error.message, {
      hint: error.hints[0],
      exitCode: opts?.exitCode ?? error.exitCode,
    });
    return;
  }
  const mapped = mapUserFacingError(error);
  const commanderHint = isCommanderError(error)
    ? undefined
    : mapped.hint;
  fail(mapped.message, {
    hint: commanderHint,
    exitCode: opts?.exitCode ?? mapped.exitCode,
  });
}

export function formatScenarioCommand(path: string): string {
  const trimmed = path.trim();
  const stripped = trimmed.replace(/^(?:harnesstap|ht)\s+/, "");
  return formatCommand(stripped);
}

export function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function reportNoGitOrigin(_retryCommand?: string): void {
  fail("No git remote origin configured.", {
    hint: GIT_ORIGIN_HINTS[0],
  });
}

export function isVerboseMode(argv: string[] = process.argv): boolean {
  return argv.includes("-v") || argv.includes("--verbose");
}

export function isGroupedCommandFallbackError(error: unknown): error is {
  code: string;
  exitCode: number;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    exitCode?: unknown;
    message?: unknown;
  };

  return candidate.code === "commander.excessArguments"
    && candidate.exitCode === 1
    && typeof candidate.message === "string"
    && /too many arguments for '(plugin|resource|plugin|auth|migrate|harness|environment|profile)'/i.test(candidate.message);
}
