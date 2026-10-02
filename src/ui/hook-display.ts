const KNOWN_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "PermissionRequest",
  "PreCompact",
  "Stop",
  "SubagentStop",
  "Setup",
] as const;

const INTERPRETERS = new Set([
  "node",
  "nodejs",
  "bun",
  "deno",
  "python",
  "python3",
  "python2",
  "bash",
  "sh",
  "zsh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "npx",
  "pnpm",
  "yarn",
  "bunx",
  "ts-node",
  "tsx",
]);

const SCRIPT_EXT = /\.(js|mjs|cjs|ts|tsx|sh|bash|zsh|py|rb|pl|ps1|cmd|bat)$/i;

export interface HookInventoryWire {
  event: string;
  script: string;
  matcher?: string;
  type?: string;
}

export interface HookDisplayInput {
  event?: string | null;
  name?: string | null;
  script?: string | null;
  content?: string | null;
  matcher?: string | null;
  hookType?: string | null;
  hook?: HookInventoryWire | null;
  metadata?: {
    event?: unknown;
    script?: unknown;
    matcher?: unknown;
    hook_entry?: unknown;
  } | null;
}

function compactEventKey(value: string): string {
  return value.replace(/[_\-\s]+/g, "").toLowerCase();
}

export function normalizeHookEventName(event: string): string {
  const trimmed = event.trim();
  if (!trimmed) {
    return trimmed;
  }
  const compact = compactEventKey(trimmed);
  const known = KNOWN_HOOK_EVENTS.find((name) => name.toLowerCase() === compact);
  if (known) {
    return known;
  }
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
    return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
  }
  return trimmed
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
}

export function eventFromHookResourceName(name: string | null | undefined): string | undefined {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }
  const compactName = compactEventKey(trimmed);
  const known = [...KNOWN_HOOK_EVENTS]
    .sort((left, right) => right.length - left.length)
    .find((event) => {
      const compact = event.toLowerCase();
      return compactName === compact || compactName.startsWith(compact);
    });
  if (known) {
    return known;
  }
  const dash = trimmed.search(/[-_\s]/);
  if (dash > 0) {
    return normalizeHookEventName(trimmed.slice(0, dash));
  }
  return normalizeHookEventName(trimmed);
}

function stripWrappingQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

export function pathBasename(path: string): string {
  const trimmed = stripWrappingQuotes(path.trim()).replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function looksLikePath(token: string): boolean {
  return token.includes("/") || token.includes("\\") || SCRIPT_EXT.test(token);
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

export function hookCommandShortToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }
  const tokens = tokenizeCommand(trimmed).filter((token) => !/^\w+=/.test(token));
  if (tokens.length === 0) {
    return pathBasename(trimmed);
  }
  const first = tokens[0] ?? "";
  const firstBase = pathBasename(first);
  if (looksLikePath(first)) {
    return firstBase;
  }
  if (INTERPRETERS.has(firstBase.toLowerCase())) {
    const script = tokens.slice(1).find((token) => looksLikePath(token) && !token.startsWith("-"));
    if (script) {
      return pathBasename(script);
    }
  }
  return firstBase;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hookEntryType(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "";
  }
  return stringField((entry as { type?: unknown }).type);
}

export function hookDisplayInputFromResource(resource: HookDisplayInput): HookDisplayInput {
  const metadata = resource.metadata ?? undefined;
  const hook = resource.hook ?? undefined;
  const event = resource.event ?? hook?.event ?? stringField(metadata?.event);
  const script =
    resource.script
    ?? hook?.script
    ?? stringField(metadata?.script)
    ?? resource.content
    ?? "";
  const matcher = resource.matcher ?? hook?.matcher ?? stringField(metadata?.matcher);
  const hookType =
    resource.hookType ?? hook?.type ?? hookEntryType(metadata?.hook_entry);
  return {
    event: event || undefined,
    name: resource.name,
    script: script || undefined,
    content: resource.content,
    matcher: matcher || undefined,
    hookType: hookType || undefined,
    hook,
    metadata,
  };
}

export function hookInventoryWireFromResource(resource: {
  type?: string | null;
  content?: string | null;
  metadata?: unknown;
}): HookInventoryWire | undefined {
  if (resource.type !== "hook") {
    return undefined;
  }
  const metadata =
    resource.metadata && typeof resource.metadata === "object" && !Array.isArray(resource.metadata)
      ? (resource.metadata as HookDisplayInput["metadata"])
      : undefined;
  const event = stringField(metadata?.event);
  const script = stringField(metadata?.script) || stringField(resource.content);
  if (!event && !script) {
    return undefined;
  }
  const matcher = stringField(metadata?.matcher);
  const type = hookEntryType(metadata?.hook_entry);
  return {
    event,
    script,
    ...(matcher ? { matcher } : {}),
    ...(type ? { type } : {}),
  };
}

function resolvedEvent(input: HookDisplayInput): string {
  const raw = input.event?.trim() || eventFromHookResourceName(input.name) || "";
  return raw ? normalizeHookEventName(raw) : "";
}

function resolvedCommand(input: HookDisplayInput): string {
  return (input.script ?? input.content ?? "").trim();
}

export function formatHookInventoryLabel(input: HookDisplayInput): string {
  const resolved = hookDisplayInputFromResource(input);
  const command = resolvedCommand(resolved);
  const short = hookCommandShortToken(command);
  const event = resolvedEvent(resolved);
  if (!short) {
    return resolved.name?.trim() || event;
  }
  if (!event) {
    return short;
  }
  return `${event}: ${short}`;
}

export function formatHookInventoryTooltipLines(input: HookDisplayInput): string[] {
  const resolved = hookDisplayInputFromResource(input);
  const lines: string[] = [];
  const matcher = resolved.matcher?.trim();
  if (matcher) {
    lines.push(`matcher: ${matcher}`);
  }
  const hookType = resolved.hookType?.trim();
  if (hookType) {
    lines.push(`type: ${hookType}`);
  }
  const command = resolvedCommand(resolved);
  const short = hookCommandShortToken(command);
  if (command && command !== short) {
    lines.push(command);
  }
  return lines;
}
