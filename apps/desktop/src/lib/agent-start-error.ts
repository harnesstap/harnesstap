import { AGENT_START_COPY, CONNECT_SPLASH_COPY } from "./ui-copy";

const HT_FATAL_PREFIX = "HT_FATAL ";

type AgentFatalCode = "newer_schema" | "port_in_use" | "home_not_writable";

function invokeMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error ?? "");
}

function isFatalCode(value: string): value is AgentFatalCode {
  return (
    value === "newer_schema"
    || value === "port_in_use"
    || value === "home_not_writable"
  );
}

export function parseHtFatalPayload(text: string): AgentFatalCode | null {
  let found: AgentFatalCode | null = null;
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
        && typeof parsed.code === "string"
        && isFatalCode(parsed.code)
      ) {
        found = parsed.code;
      }
    } catch {
      // Ignore malformed HT_FATAL lines.
    }
  }
  return found;
}

function copyForFatalCode(code: AgentFatalCode): string {
  switch (code) {
    case "newer_schema":
      return AGENT_START_COPY.newerSchema;
    case "port_in_use":
      return AGENT_START_COPY.portInUse;
    case "home_not_writable":
      return AGENT_START_COPY.homeNotWritable;
    default: {
      const neverCode: never = code;
      return neverCode;
    }
  }
}

/** Map agent start failures to splash copy. Never shows "sidecar". */
export function formatAgentStartError(error: unknown): string {
  const raw = invokeMessage(error);
  const code = parseHtFatalPayload(raw);
  if (code) {
    return copyForFatalCode(code);
  }
  if (/newer than this binary|schema v\d+ is newer/i.test(raw)) {
    return AGENT_START_COPY.newerSchema;
  }
  if (/EADDRINUSE|address already in use|port .*already in use/i.test(raw)) {
    return AGENT_START_COPY.portInUse;
  }
  if (/permission denied|not writable|EROFS|EACCES|data folder/i.test(raw)) {
    return AGENT_START_COPY.homeNotWritable;
  }
  if (
    /Failed to fetch|Sidecar|not reachable|Could not connect|load failed/i.test(
      raw,
    )
  ) {
    return CONNECT_SPLASH_COPY.unreachable;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return CONNECT_SPLASH_COPY.unreachable;
  }
  return trimmed.replaceAll(/sidecar/gi, "agent");
}
