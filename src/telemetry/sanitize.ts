import type { TelemetryProps } from "./types.js";

const SECRET_KEY =
  /(token|secret|password|passwd|authorization|cookie|api[_-]?key|refresh|bearer|email)/i;

/** Keys that would contradict “no personal data / no resource-related information”. */
const BLOCKED_KEY =
  /^(plugin_slug|org_id|path|filepath|file_path|content|contents|mcp|mcp_config)$/i;

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function shortReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function sanitizeTelemetryProps(props: TelemetryProps): TelemetryProps {
  const next: TelemetryProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (SECRET_KEY.test(key) || BLOCKED_KEY.test(key)) {
      continue;
    }
    if (typeof value === "string") {
      if (looksLikeEmail(value)) {
        continue;
      }
      next[key] = value.slice(0, 200);
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function extractCloudUserId(
  whoami: Record<string, unknown> | undefined,
  accountUserId?: string,
): string | undefined {
  if (accountUserId && !looksLikeEmail(accountUserId)) {
    return accountUserId;
  }
  if (!whoami) {
    return undefined;
  }
  const user =
    typeof whoami.user === "object" && whoami.user !== null
      ? (whoami.user as Record<string, unknown>)
      : undefined;
  const candidates = [user?.id, whoami.user_id, whoami.id, whoami.sub];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && !looksLikeEmail(candidate)) {
      return candidate.trim();
    }
  }
  return undefined;
}
