import { CLI_ERRORS, CLI_HINTS } from "./messages.js";
import { gitFailureHint, mapGitStderr } from "../utils/git-errors.js";

export { gitFailureHint, mapGitStderr } from "../utils/git-errors.js";

export interface MappedCliError {
  message: string;
  hint?: string;
  exitCode: number;
}

function nodePathFromEnoent(error: Error): string | undefined {
  if ("path" in error && typeof error.path === "string" && error.path.length > 0) {
    return error.path;
  }
  const match = /ENOENT: no such file or directory, (?:stat|open|scandir|mkdir|unlink) '([^']+)'/.exec(
    error.message,
  );
  return match?.[1];
}

export function isSqliteUniqueError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE"
    || code === "SQLITE_CONSTRAINT"
    || message.includes("UNIQUE constraint failed")
  );
}

function mapSqliteUnique(message: string): MappedCliError {
  if (message.includes("plugins.")) {
    return {
      message: CLI_ERRORS.uniqueConstraintGeneric.replace(
        "That name already exists.",
        "A plugin with that name already exists.",
      ),
      hint: CLI_HINTS.onConflictReplace,
      exitCode: 1,
    };
  }
  if (message.includes("environments")) {
    return {
      message: "An environment with that name already exists.",
      hint: CLI_HINTS.onConflictReplace,
      exitCode: 1,
    };
  }
  return {
    message: CLI_ERRORS.uniqueConstraintGeneric,
    hint: CLI_HINTS.onConflictReplace,
    exitCode: 1,
  };
}

function commanderExitCode(error: unknown): number {
  if (error && typeof error === "object" && "exitCode" in error) {
    const raw = (error as { exitCode?: unknown }).exitCode;
    if (typeof raw === "number" && raw > 0) {
      return raw;
    }
  }
  return 1;
}

export function isCommanderError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return String((error as { code?: unknown }).code ?? "").startsWith("commander.");
}

export function mapUserFacingError(error: unknown): MappedCliError {
  const exitCode = commanderExitCode(error);

  if (error instanceof Error && isSqliteUniqueError(error)) {
    return { ...mapSqliteUnique(error.message), exitCode };
  }

  if (error instanceof Error) {
    const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "ENOENT") {
      const filePath = nodePathFromEnoent(error);
      return {
        message: CLI_ERRORS.fileNotFound(filePath ?? "that path"),
        exitCode,
      };
    }
    const lower = error.message.toLowerCase();
    if (
      lower.includes("could not read username")
      || lower.includes("terminal prompts disabled")
      || lower.includes("authentication failed")
      || /\bfatal:/.test(lower)
      || error.message.startsWith("Couldn't reach")
    ) {
      return {
        message: mapGitStderr(error.message),
        hint: gitFailureHint(),
        exitCode,
      };
    }
    return { message: error.message, exitCode };
  }

  return { message: String(error), exitCode };
}

export function commanderHelpHint(commandPath: string): string {
  return CLI_HINTS.seeOptions(commandPath);
}
