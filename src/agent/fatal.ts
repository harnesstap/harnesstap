export const HT_FATAL_PREFIX = "HT_FATAL ";

export const AGENT_FATAL_CODES = [
  "newer_schema",
  "port_in_use",
  "home_not_writable",
] as const;

export type AgentFatalCode = (typeof AGENT_FATAL_CODES)[number];

export interface AgentFatal {
  code: AgentFatalCode;
  message: string;
}

function isAgentFatalCode(value: string): value is AgentFatalCode {
  return (AGENT_FATAL_CODES as readonly string[]).includes(value);
}

export function formatHtFatal(fatal: AgentFatal): string {
  return `${HT_FATAL_PREFIX}${JSON.stringify({
    code: fatal.code,
    message: fatal.message,
  })}`;
}

export function emitHtFatal(fatal: AgentFatal): void {
  console.error(formatHtFatal(fatal));
}

export function parseHtFatal(text: string): AgentFatal | null {
  let found: AgentFatal | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const payload = trimmed.startsWith(HT_FATAL_PREFIX)
      ? trimmed.slice(HT_FATAL_PREFIX.length)
      : trimmed.includes(HT_FATAL_PREFIX)
        ? trimmed.slice(trimmed.indexOf(HT_FATAL_PREFIX) + HT_FATAL_PREFIX.length)
        : null;
    if (!payload) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(payload);
      if (
        parsed
        && typeof parsed === "object"
        && "code" in parsed
        && "message" in parsed
        && typeof parsed.code === "string"
        && typeof parsed.message === "string"
        && isAgentFatalCode(parsed.code)
      ) {
        found = { code: parsed.code, message: parsed.message };
      }
    } catch {
      // Ignore malformed HT_FATAL lines; keep scanning for a later valid one.
    }
  }
  return found;
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyAgentStartError(error: unknown): AgentFatal | null {
  const message = errorMessage(error);
  const code = errorCode(error);
  if (
    /newer than this binary/i.test(message)
    || /schema v\d+ is newer/i.test(message)
  ) {
    return {
      code: "newer_schema",
      message: "Database schema is newer than this HarnessTap build.",
    };
  }
  if (
    code === "EADDRINUSE"
    || /EADDRINUSE|address already in use|Unable to bind HarnessTap agent/i.test(
      message,
    )
  ) {
    return {
      code: "port_in_use",
      message: "The HarnessTap agent port is already in use.",
    };
  }
  if (
    code === "EACCES"
    || code === "EPERM"
    || code === "EROFS"
    || /permission denied|read-only file system|not writable|EROFS/i.test(message)
  ) {
    return {
      code: "home_not_writable",
      message: "The HarnessTap data folder is not writable.",
    };
  }
  return null;
}

export function emitAgentFatalFromError(error: unknown): AgentFatal | null {
  const original = errorMessage(error).trim();
  if (original) {
    console.error(original);
  }
  const fatal = classifyAgentStartError(error);
  if (fatal) {
    emitHtFatal(fatal);
  }
  return fatal;
}
